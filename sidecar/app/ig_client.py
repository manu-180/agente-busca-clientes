"""
instagrapi wrapper — singleton IGClient.

Responsibilities:
  - login()           — load session from disk or do fresh login (+ optional TOTP).
  - send_dm()         — send a DM with optional humanize dwell/typing simulation.
  - poll_inbox()      — return messages newer than since_ts from all threads.
  - enrich_profiles() — batch-enrich profiles (max 20, 30s pause between batches).

The singleton is accessed via get_ig_client(). Routes call login() once at boot
(via main.py lifespan); subsequent calls reuse the cached Client object.

Exceptions from instagrapi propagate to routes, which delegate to
circuit_breaker.map_and_raise() for mapping to HTTP 503/500.
"""

import logging
import os
import time
from dataclasses import dataclass
from typing import Optional

from app import humanize, session_store

logger = logging.getLogger(__name__)

IG_USERNAME: str = os.environ.get("IG_USERNAME", "")
IG_PASSWORD: str = os.environ.get("IG_PASSWORD", "")
IG_TOTP_SEED: str = os.environ.get("IG_TOTP_SEED", "")

# ── data classes ─────────────────────────────────────────────────────────────


@dataclass
class InboxMessage:
    thread_id: str
    message_id: str
    ig_username: str
    text: str
    timestamp: int
    is_outbound: bool


# ── IGClient ──────────────────────────────────────────────────────────────────


class IGClient:
    """Thin wrapper around instagrapi.Client with session persistence."""

    def __init__(self) -> None:
        self._cl = None          # instagrapi.Client instance
        self._session_valid: bool = False

    # ── internal helpers ─────────────────────────────────────────────────────

    def _build_client(self):
        from instagrapi import Client

        cl = Client()
        cl.delay_range = [1, 3]   # light built-in delay between API calls
        return cl

    # ── public: login ────────────────────────────────────────────────────────

    def login(self) -> None:
        """
        Try to rehydrate an existing session from disk; fall back to fresh login.

        On failure, sets _session_valid=False and logs the error but does NOT
        raise — callers check session_valid and report /health as 'degraded'.
        """
        username = os.environ.get("IG_USERNAME", IG_USERNAME)
        password = os.environ.get("IG_PASSWORD", IG_PASSWORD)
        totp_seed = os.environ.get("IG_TOTP_SEED", IG_TOTP_SEED)

        cl = self._build_client()
        session_data = session_store.load()

        if session_data:
            try:
                cl.set_settings(session_data)
                cl.login(username, password)
                logger.info("Session rehydrated from disk.")
                self._cl = cl
                self._session_valid = True
                return
            except Exception as exc:
                logger.warning(f"Session rehydration failed, fresh login: {exc}")
                cl = self._build_client()

        # Fresh login (with optional TOTP)
        try:
            totp_code: str = ""
            if totp_seed:
                totp_code = cl.totp_generate_code(totp_seed)

            cl.login(username, password, verification_code=totp_code)
            session_store.save(cl.get_settings())
            logger.info("Fresh login successful, session persisted.")
            self._cl = cl
            self._session_valid = True
        except Exception as exc:
            logger.error(f"Login failed: {exc}")
            self._session_valid = False
            # Don't raise — Railway will see /health → degraded and retry.

    @property
    def session_valid(self) -> bool:
        return self._session_valid

    def _client(self):
        """Return the underlying instagrapi.Client or raise if not initialized."""
        if self._cl is None:
            raise RuntimeError("IGClient not initialized — call login() first.")
        return self._cl

    # ── public: send_dm ──────────────────────────────────────────────────────

    def send_dm(
        self, username: str, text: str, simulate_human: bool = True
    ) -> tuple[str, str]:
        """
        Send a DM to `username`. Returns (thread_id, message_id).

        When simulate_human=True: dwell 3–15s + typing simulation before sending.
        Saves session after a successful send to keep cookies fresh.
        Propagates instagrapi exceptions; routes delegate to circuit_breaker.
        """
        cl = self._client()

        user_info = cl.user_info_by_username(username)
        user_id = user_info.pk

        if simulate_human:
            humanize.dwell(3, 15)
            humanize.typing_sim(text)

        thread = cl.direct_send(text, [user_id])
        session_store.save(cl.get_settings())   # refresh cookies on disk

        thread_id = str(thread.id)
        message_id = str(thread.messages[0].id) if thread.messages else ""
        return thread_id, message_id

    # ── public: poll_inbox ───────────────────────────────────────────────────

    def poll_inbox(self, since_ts: Optional[int] = None) -> list[InboxMessage]:
        """
        Return messages (inbound + outbound) across recent threads.

        Filters to messages with timestamp > since_ts when provided.
        Includes outbound messages so the caller can deduplicate.
        """
        cl = self._client()
        result: list[InboxMessage] = []

        threads = cl.direct_threads(amount=20)
        for thread in threads:
            thread_id = str(thread.id)
            try:
                msgs = cl.direct_messages(thread_id, amount=10)
            except Exception as exc:
                logger.warning(f"Could not fetch messages for thread {thread_id}: {exc}")
                continue

            for msg in msgs:
                msg_ts = int(msg.timestamp.timestamp()) if msg.timestamp else 0

                if since_ts is not None and msg_ts <= since_ts:
                    continue

                text = getattr(msg, "text", "") or ""
                if not text:
                    continue  # skip media/reactions/etc.

                is_outbound = str(msg.user_id) == str(cl.user_id)

                # Resolve username from thread participants
                ig_username = ""
                for user in thread.users:
                    if str(user.pk) == str(msg.user_id):
                        ig_username = user.username
                        break
                if not ig_username and is_outbound:
                    ig_username = os.environ.get("IG_USERNAME", IG_USERNAME)

                result.append(
                    InboxMessage(
                        thread_id=thread_id,
                        message_id=str(msg.id),
                        ig_username=ig_username,
                        text=text,
                        timestamp=msg_ts,
                        is_outbound=is_outbound,
                    )
                )

        return result

    # ── public: enrich_profiles ──────────────────────────────────────────────

    def enrich_profiles(
        self, usernames: list[str]
    ) -> tuple[list[dict], dict[str, str]]:
        """
        Fetch profile data for a list of usernames.

        Batches of max 20 with a 30s pause between batches (anti-ban).
        UserNotFound / PrivateAccountError go into the errors dict (no circuit).
        Other instagrapi exceptions propagate to the route for circuit handling.
        """
        from instagrapi.exceptions import PrivateAccountError, UserNotFound

        cl = self._client()
        profiles: list[dict] = []
        errors: dict[str, str] = {}

        batch_size = 20
        for i in range(0, len(usernames), batch_size):
            if i > 0:
                logger.info("Waiting 30s between enrich batches…")
                time.sleep(30)

            for username in usernames[i : i + batch_size]:
                try:
                    humanize.dwell(1, 3)   # light throttle per lookup
                    info = cl.user_info_by_username(username)

                    bio_links: list[dict] = []
                    if hasattr(info, "bio_links") and info.bio_links:
                        for link in info.bio_links:
                            bio_links.append(
                                {
                                    "url": str(link.url)
                                    if hasattr(link, "url")
                                    else str(link),
                                    "title": getattr(link, "title", None),
                                }
                            )

                    last_post_at: Optional[str] = None
                    try:
                        medias = cl.user_medias(info.pk, 1)
                        if medias and medias[0].taken_at:
                            last_post_at = medias[0].taken_at.isoformat()
                    except Exception:
                        pass  # not critical

                    profiles.append(
                        {
                            "ig_user_id": str(info.pk),
                            "ig_username": info.username,
                            "full_name": info.full_name or None,
                            "biography": info.biography or None,
                            "external_url": str(info.external_url)
                            if info.external_url
                            else None,
                            "bio_links": bio_links,
                            "followers_count": info.follower_count or 0,
                            "following_count": info.following_count or 0,
                            "posts_count": info.media_count or 0,
                            "is_private": info.is_private or False,
                            "is_verified": info.is_verified or False,
                            "is_business": info.is_business or False,
                            "business_category": getattr(info, "category", None),
                            "profile_pic_url": str(info.profile_pic_url)
                            if info.profile_pic_url
                            else None,
                            "last_post_at": last_post_at,
                        }
                    )

                except (UserNotFound, PrivateAccountError) as exc:
                    errors[username] = type(exc).__name__
                    logger.info(f"Profile {username} not accessible: {type(exc).__name__}")

        return profiles, errors


# ── singleton ─────────────────────────────────────────────────────────────────

_ig_client: Optional[IGClient] = None


def get_ig_client() -> IGClient:
    """Return the module-level IGClient singleton (lazy init)."""
    global _ig_client
    if _ig_client is None:
        _ig_client = IGClient()
    return _ig_client


def reset_ig_client() -> None:
    """Force re-creation on next get_ig_client() call (e.g. after challenge)."""
    global _ig_client
    _ig_client = None
