-- Venezuelan payment methods (Phase 3).
--
-- Guests pay the restaurant directly; TabTap records each payment and its platform
-- fee (invoiced to the restaurant monthly). Methods:
--   card          card via the payment gateway (mock today)           — bill currency
--   pago_movil    bank transfer by phone; guest submits the reference  — VES
--   zelle         US bank transfer; guest submits the confirmation     — USD
--   binance_pay   USDT via Binance Pay; guest submits the order id     — USD (1:1)
--   cash_usd / cash_ves   paid to the waiter, who confirms it          — USD / VES
-- Proof-based methods are verified by staff, or by the built-in simulator for demos.

CREATE TABLE tenant_payment_methods (
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  method        TEXT NOT NULL CHECK (method IN ('card', 'pago_movil', 'zelle', 'binance_pay', 'cash_usd', 'cash_ves')),
  enabled       BOOLEAN NOT NULL DEFAULT true,
  -- Extra charge on top of the converted amount, e.g. IGTF 3% (300) on foreign currency
  -- received outside the Venezuelan banking system, where the restaurant must collect it.
  surcharge_bps INT NOT NULL DEFAULT 0 CHECK (surcharge_bps BETWEEN 0 AND 1000),
  -- Where to pay (bank / phone / RIF, Zelle email, Binance Pay ID, …) and how to verify.
  details       JSONB NOT NULL DEFAULT '{}',
  sort_order    INT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, method)
);

ALTER TABLE tenant_payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_payment_methods
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE payments
  ADD COLUMN method        TEXT NOT NULL DEFAULT 'card'
    CHECK (method IN ('card', 'pago_movil', 'zelle', 'binance_pay', 'cash_usd', 'cash_ves')),
  ADD COLUMN surcharge_bps   INT NOT NULL DEFAULT 0,
  -- In the charge currency; included in charge_amount_minor.
  ADD COLUMN surcharge_minor BIGINT NOT NULL DEFAULT 0 CHECK (surcharge_minor >= 0),
  -- What the guest reported (reference number, payer phone/bank/name).
  ADD COLUMN proof           JSONB,
  ADD COLUMN proof_submitted_at TIMESTAMPTZ,
  -- Staff member who confirmed or rejected an offline payment.
  ADD COLUMN reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE payments ALTER COLUMN method DROP DEFAULT;
CREATE INDEX payments_awaiting_review_idx ON payments (tenant_id, created_at) WHERE status = 'pending';

-- Exchange rate source per restaurant: entered by hand, or the BCV official rate
-- fetched automatically.
ALTER TABLE tenants ADD COLUMN rate_source TEXT NOT NULL DEFAULT 'manual' CHECK (rate_source IN ('manual', 'bcv'));

-- Demo restaurant: every method on, sample payee details, simulated Pago Móvil checks,
-- IGTF on foreign-currency methods, and the BCV rate fetched automatically.
INSERT INTO tenant_payment_methods (tenant_id, method, surcharge_bps, details, sort_order)
SELECT '11111111-1111-1111-1111-111111111111', m.method, m.surcharge_bps, m.details::jsonb, m.sort_order
FROM (VALUES
  ('pago_movil', 0, '{"bank": "0134 Banesco", "phone": "0414-555-0123", "documentId": "J-50123456-7", "holderName": "Demo Restaurant C.A.", "verification": "simulated"}', 1),
  ('card', 0, '{}', 2),
  ('zelle', 300, '{"email": "pagos@demo-restaurant.example", "holderName": "Demo Restaurant LLC", "verification": "staff"}', 3),
  ('binance_pay', 300, '{"payId": "123456789", "holderName": "DemoRestaurant", "verification": "staff"}', 4),
  ('cash_usd', 300, '{}', 5),
  ('cash_ves', 0, '{}', 6)
) AS m(method, surcharge_bps, details, sort_order)
WHERE EXISTS (SELECT 1 FROM tenants WHERE id = '11111111-1111-1111-1111-111111111111');

UPDATE tenants SET rate_source = 'bcv' WHERE id = '11111111-1111-1111-1111-111111111111';

-- Every other existing restaurant keeps working as before: card payments in the bill
-- currency.
INSERT INTO tenant_payment_methods (tenant_id, method, sort_order)
SELECT t.id, 'card', 1 FROM tenants t
WHERE t.id <> '11111111-1111-1111-1111-111111111111'
ON CONFLICT DO NOTHING;
