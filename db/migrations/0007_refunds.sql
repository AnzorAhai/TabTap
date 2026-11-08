-- Refunds (Phase 4): who gave a settled payment back, when and why.

ALTER TABLE payments
  ADD COLUMN refunded_at   TIMESTAMPTZ,
  ADD COLUMN refunded_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN refund_reason TEXT;

-- Daily summaries and fee reports read settled payments by time.
CREATE INDEX payments_tenant_settled_idx ON payments (tenant_id, settled_at) WHERE status = 'succeeded';
