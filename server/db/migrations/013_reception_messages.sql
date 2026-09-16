-- 013 Front-desk messages: two more channels.
--
-- message_log was written when every message was something DocDesk would send:
-- an email, an SMS, a WhatsApp. A message taken at the front desk is often
-- neither - somebody rang, said a thing, and left no way to reply. That is a
-- 'note'. Recording it as an email with no recipient would be a small lie that
-- the Messages page would then have to explain.
--
-- A CHECK constraint cannot be replaced in place, so it is dropped and recreated.

ALTER TABLE message_log DROP CONSTRAINT IF EXISTS message_log_channel_check;
ALTER TABLE message_log ADD CONSTRAINT message_log_channel_check
  CHECK (channel IN ('email', 'sms', 'whatsapp', 'call', 'note'));

COMMENT ON COLUMN message_log.channel IS 'How it would go out, or how it came in. "note" and "call" are records of something said rather than something to send, so the sender skips them.';

-- The mock sender flips every queued row to 'sent'. A note has nowhere to go,
-- so it would be marked sent without anything happening. Held as queued until
-- somebody deals with it, which is what the Front Desk inbox shows.
CREATE INDEX IF NOT EXISTS message_log_open_notes_idx
  ON message_log (created_at DESC)
  WHERE channel IN ('call', 'note') AND status = 'queued';
