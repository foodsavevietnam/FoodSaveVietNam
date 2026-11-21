-- Additive Neon-only community feed. Supabase auth, storage, and app tables
-- remain unchanged; no rows are copied or linked to Supabase identifiers.
BEGIN;

CREATE SCHEMA IF NOT EXISTS mio;

CREATE TABLE IF NOT EXISTS mio.activity_events (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('product_created', 'order_created', 'donation_created')),
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT activity_events_type_source_unique UNIQUE (event_type, source_id)
);

CREATE INDEX IF NOT EXISTS activity_events_created_at_id_idx
  ON mio.activity_events (created_at DESC, id DESC);

COMMIT;
