-- Fix senders unique constraint to allow multiple evolution senders without phone number.
-- The old index treated ('', 'evolution') as duplicates; Evolution senders start
-- without a known phone (filled in after QR scan), so the constraint must only
-- apply when phone_number is non-empty.

DROP INDEX IF EXISTS public.senders_phone_provider_idx;

CREATE UNIQUE INDEX senders_phone_provider_idx
  ON public.senders (phone_number, provider)
  WHERE phone_number <> '';
