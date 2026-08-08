-- Two more demo tables for a live walkthrough, matching the extra bills
-- seeded in MockPOSConnector (qr_token 'table-2' / 'table-3').

INSERT INTO tables (id, tenant_id, venue_id, label, qr_token, is_active)
VALUES
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Table 2', 'table-2', true),
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Table 3', 'table-3', true)
ON CONFLICT (id) DO NOTHING;
