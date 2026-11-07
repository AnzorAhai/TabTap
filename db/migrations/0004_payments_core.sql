-- Core payment model (Phase 1).
--
-- TabTap's own database becomes the source of truth for what guests have paid:
-- a bill's remaining amount is its POS total minus settled TabTap payments minus
-- payments still in progress. A pending payment *is* the hold on the items or
-- equal-split shares it covers, until it settles, fails, is canceled or expires.
-- The per-guest "splits / split_participants" model is replaced by that.

-- ---------------------------------------------------------------------------
-- Tenants: payment settings (move to venue level when venues get their own).

ALTER TABLE tenants
  ADD COLUMN platform_fee_bps    INT   NOT NULL DEFAULT 150 CHECK (platform_fee_bps BETWEEN 0 AND 10000),
  ADD COLUMN payment_currencies  JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN tip_percent_options JSONB NOT NULL DEFAULT '[0, 5, 10, 15]';

COMMENT ON COLUMN tenants.payment_currencies IS
  'Currencies guests may pay in besides the bill currency, e.g. ["VES"]; each needs an exchange rate.';

-- ---------------------------------------------------------------------------
-- Bills: one row per (table, POS bill); POS snapshot fields kept apart from
-- what TabTap tracks (paid_minor, status).

ALTER TABLE bills
  ADD COLUMN service_charge_minor BIGINT      NOT NULL DEFAULT 0,
  ADD COLUMN pos_status           TEXT        NOT NULL DEFAULT 'open' CHECK (pos_status IN ('open', 'closed')),
  ADD COLUMN updated_at           TIMESTAMPTZ NOT NULL DEFAULT now();

-- Concurrent first scans used to create duplicate rows. Keep the oldest of each
-- group and move any payments of the others onto it before deleting them.
CREATE TEMP TABLE bill_duplicates ON COMMIT DROP AS
SELECT b.id AS duplicate_id, keep.id AS keep_id
FROM bills b
JOIN LATERAL (
  SELECT k.id FROM bills k
  WHERE k.table_id = b.table_id AND k.external_pos_id = b.external_pos_id
  ORDER BY k.created_at, k.id
  LIMIT 1
) keep ON keep.id <> b.id;

UPDATE payments p SET bill_id = d.keep_id FROM bill_duplicates d WHERE p.bill_id = d.duplicate_id;
DELETE FROM bills b USING bill_duplicates d WHERE b.id = d.duplicate_id;

CREATE UNIQUE INDEX bills_table_pos_bill_key ON bills (table_id, external_pos_id);

-- ---------------------------------------------------------------------------
-- Tables: the POS's own id for the table, independent of the QR token (QR tokens
-- become random and rotatable; the POS reference must stay stable).

ALTER TABLE tables ADD COLUMN pos_table_ref TEXT;
UPDATE tables SET pos_table_ref = qr_token;
ALTER TABLE tables ALTER COLUMN pos_table_ref SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Payments.

ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'succeeded', 'failed', 'expired', 'canceled', 'refunded'));

ALTER TABLE payments
  ADD COLUMN mode                TEXT NOT NULL DEFAULT 'full' CHECK (mode IN ('full', 'items', 'shares')),
  ADD COLUMN item_ids            JSONB,
  ADD COLUMN share_indices       INT[],
  ADD COLUMN idempotency_key     TEXT,
  ADD COLUMN provider            TEXT NOT NULL DEFAULT 'mock',
  ADD COLUMN charge_currency     TEXT,
  ADD COLUMN charge_amount_minor BIGINT,
  ADD COLUMN exchange_rate       NUMERIC(20, 8) CHECK (exchange_rate > 0),
  ADD COLUMN expires_at          TIMESTAMPTZ,
  ADD COLUMN settled_at          TIMESTAMPTZ,
  ADD COLUMN failure_reason      TEXT,
  ADD COLUMN updated_at          TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE payments
SET charge_currency     = currency,
    charge_amount_minor = amount_minor + tip_minor,
    settled_at          = CASE WHEN status = 'succeeded' THEN created_at END;

ALTER TABLE payments
  ALTER COLUMN charge_currency SET NOT NULL,
  ALTER COLUMN charge_amount_minor SET NOT NULL,
  ALTER COLUMN mode DROP DEFAULT,
  ALTER COLUMN provider DROP DEFAULT;

ALTER TABLE payments ADD CONSTRAINT payments_amounts_check
  CHECK (amount_minor > 0 AND tip_minor >= 0 AND platform_fee_minor >= 0 AND charge_amount_minor > 0);
ALTER TABLE payments ADD CONSTRAINT payments_mode_claim_check
  CHECK (
    (mode = 'items' AND item_ids IS NOT NULL AND share_indices IS NULL) OR
    (mode = 'shares' AND share_indices IS NOT NULL AND item_ids IS NULL) OR
    (mode = 'full' AND item_ids IS NULL AND share_indices IS NULL)
  );

-- Mock references restarted from 1 on every API restart, so older ones repeat.
UPDATE payments SET provider_ref = 'legacy-' || id::text WHERE provider_ref LIKE 'mock-pi-%';

CREATE UNIQUE INDEX payments_bill_idempotency_key ON payments (bill_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX payments_provider_ref_key ON payments (provider, provider_ref)
  WHERE provider_ref IS NOT NULL;
CREATE INDEX payments_bill_status_idx ON payments (bill_id, status);
CREATE INDEX payments_tenant_created_idx ON payments (tenant_id, created_at DESC);
CREATE INDEX payments_pending_expiry_idx ON payments (expires_at) WHERE status = 'pending';

-- The old per-guest split model.
ALTER TABLE payments DROP COLUMN split_participant_id;
DROP TABLE split_participants;
DROP TABLE splits;

-- What each bill has been paid through TabTap, recomputed under the new rules.
UPDATE bills b
SET paid_minor = COALESCE(
      (SELECT sum(p.amount_minor) FROM payments p WHERE p.bill_id = b.id AND p.status = 'succeeded'), 0),
    status = CASE
      WHEN COALESCE((SELECT sum(p.amount_minor) FROM payments p WHERE p.bill_id = b.id AND p.status = 'succeeded'), 0)
           >= b.total_minor THEN 'paid'
      WHEN EXISTS (SELECT 1 FROM payments p WHERE p.bill_id = b.id AND p.status = 'succeeded') THEN 'partially_paid'
      ELSE 'open'
    END;

-- ---------------------------------------------------------------------------
-- Receipts: exactly one per settled payment.

CREATE UNIQUE INDEX receipts_payment_key ON receipts (payment_id);

-- ---------------------------------------------------------------------------
-- Equal split: at most one per bill, shared by everyone at the table.

CREATE TABLE equal_splits (
  bill_id           UUID PRIMARY KEY REFERENCES bills(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  share_count       INT  NOT NULL CHECK (share_count BETWEEN 2 AND 30),
  -- Set when the first share payment starts; share amounts are fixed from then on.
  base_amount_minor BIGINT CHECK (base_amount_minor >= 0),
  frozen_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((base_amount_minor IS NULL) = (frozen_at IS NULL))
);

-- ---------------------------------------------------------------------------
-- Exchange rates set by each restaurant (e.g. the BCV rate USD → VES). The latest
-- row by effective_at applies; a payment stores the rate it used.

CREATE TABLE exchange_rates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  base_currency  TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate           NUMERIC(20, 8) NOT NULL CHECK (rate > 0),
  source         TEXT NOT NULL DEFAULT 'manual',
  effective_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (base_currency <> quote_currency)
);

CREATE INDEX exchange_rates_lookup_idx
  ON exchange_rates (tenant_id, base_currency, quote_currency, effective_at DESC);

-- ---------------------------------------------------------------------------
-- Outbox of POS updates: written in the same transaction that settles a payment,
-- delivered (and retried) by a background worker.

CREATE TABLE pos_sync_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bill_id         UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  payment_id      UUID NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('mark_paid')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  attempts        INT  NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pos_sync_jobs_due_idx ON pos_sync_jobs (next_attempt_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Same tenant isolation policy as every other tenant-scoped table (see 0001).

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['equal_splits', 'exchange_rates', 'pos_sync_jobs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Demo restaurant moves to the first market: Venezuela, bills in USD, guests may
-- also pay in bolívares. The rate is a placeholder — set the real BCV rate via
-- POST /admin/exchange-rates.

UPDATE tenants
SET country = 'VE', default_currency = 'USD', payment_currencies = '["VES"]'
WHERE id = '11111111-1111-1111-1111-111111111111';

UPDATE venues
SET name = 'Las Mercedes', address = 'Caracas', timezone = 'America/Caracas'
WHERE id = '22222222-2222-2222-2222-222222222222';

INSERT INTO exchange_rates (tenant_id, base_currency, quote_currency, rate, source)
SELECT '11111111-1111-1111-1111-111111111111', 'USD', 'VES', 236.50, 'demo'
WHERE EXISTS (SELECT 1 FROM tenants WHERE id = '11111111-1111-1111-1111-111111111111');
