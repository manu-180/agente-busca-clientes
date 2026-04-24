"""
Helpers to mimic human behavior on Instagram.

All sleeps are synchronous. The sidecar intentionally avoids concurrent IG
actions to prevent session corruption and reduce ban risk.

Ported from ig-sidecar/humanize.py and adjusted per SESSION-03 spec:
  - dwell default 3–15s (DM context, tighter window than browsing).
  - jitter and typing_sim unchanged.
"""

import random
import time


def dwell(min_s: float = 3, max_s: float = 15) -> None:
    """Sleep a random amount of seconds, simulating reading/browsing a profile."""
    time.sleep(random.uniform(min_s, max_s))


def jitter(
    mu: float = 540,
    sigma: float = 180,
    floor: float = 240,
    ceiling: float = 1800,
) -> float:
    """
    Gaussian jitter for spacing DMs throughout the day.

    Returns seconds to wait before the next DM.
    Defaults: μ=9 min, σ=3 min, floor=4 min, ceiling=30 min.
    """
    value = random.gauss(mu, sigma)
    return max(floor, min(ceiling, value))


def typing_sim(text: str, wpm: float = 38) -> None:
    """
    Sleep proportional to how long a human would take to type the message.

    38 WPM ≈ average mobile typing speed.
    Adds ±20 % gaussian noise. Minimum sleep is 1.5 s.
    """
    words = len(text.split())
    base_seconds = (words / wpm) * 60
    noise = random.gauss(1.0, 0.2)
    sleep_time = max(1.5, base_seconds * noise)
    time.sleep(sleep_time)
