-- Fixed demo IDs so the mock POS connector (qr_token 'table-1') has a real
-- tenant/venue/table to resolve against.

INSERT INTO tenants (id, name, country, default_currency, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'Demo Restaurant', 'DE', 'EUR', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO venues (id, tenant_id, name, timezone)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Main Hall', 'Europe/Berlin')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tables (id, tenant_id, venue_id, label, qr_token, is_active)
VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Table 1', 'table-1', true)
ON CONFLICT (id) DO NOTHING;
