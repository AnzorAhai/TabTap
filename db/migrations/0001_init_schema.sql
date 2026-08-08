-- Initial schema for TabTap. Every tenant-scoped table carries tenant_id and an
-- RLS policy so a bug in application code can't leak data across tenants.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  country         TEXT NOT NULL,
  default_currency TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE venues (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT,
  timezone    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  qr_token    TEXT NOT NULL UNIQUE,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bills (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id        UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  table_id        UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  external_pos_id TEXT NOT NULL,
  currency        TEXT NOT NULL,
  items           JSONB NOT NULL DEFAULT '[]',
  total_minor     BIGINT NOT NULL,
  paid_minor      BIGINT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partially_paid', 'paid', 'closed')),
  last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE splits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bill_id     UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('equal', 'by_items', 'by_guest')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE split_participants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  split_id          UUID NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  label             TEXT NOT NULL,
  amount_due_minor  BIGINT NOT NULL,
  amount_paid_minor BIGINT NOT NULL DEFAULT 0,
  item_ids          JSONB
);

CREATE TABLE payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bill_id               UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  split_participant_id  UUID REFERENCES split_participants(id) ON DELETE SET NULL,
  amount_minor          BIGINT NOT NULL,
  currency              TEXT NOT NULL,
  tip_minor             BIGINT NOT NULL DEFAULT 0,
  platform_fee_minor    BIGINT NOT NULL DEFAULT 0,
  status                TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  provider_ref          TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE receipts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id    UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  url           TEXT,
  delivered_to  TEXT,
  delivered_at  TIMESTAMPTZ
);

CREATE TABLE pos_connector_configs (
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id        UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  credentials_ref TEXT NOT NULL,
  settings        JSONB,
  PRIMARY KEY (tenant_id, venue_id)
);

CREATE TABLE payment_provider_configs (
  tenant_id             UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  type                  TEXT NOT NULL,
  credentials_ref       TEXT NOT NULL,
  supported_currencies  JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Row-Level Security: every tenant-scoped table is only visible to the session
-- whose app.current_tenant_id matches. The application sets this per-request;
-- this is the second barrier behind the tenant_id check in application code.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'venues', 'tables', 'bills', 'splits', 'split_participants',
    'payments', 'receipts', 'pos_connector_configs',
    'payment_provider_configs', 'audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;

CREATE INDEX idx_bills_table_id ON bills(table_id);
CREATE INDEX idx_bills_tenant_id ON bills(tenant_id);
CREATE INDEX idx_payments_bill_id ON payments(bill_id);
CREATE INDEX idx_tables_qr_token ON tables(qr_token);
