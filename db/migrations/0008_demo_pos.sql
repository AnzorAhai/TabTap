-- Investor demo (Phase 5): a restaurant in Caracas whose "POS" lives in TabTap itself.
-- Waiters punch orders on a screen in the admin panel; guests scan and pay as with a real POS.

ALTER TABLE tenants ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN tenants.is_demo IS
  'Demo restaurant: gets the demo POS screen, and its orders and payments can be wiped with "reset demo".';

UPDATE tenants
SET is_demo = true,
    name = CASE WHEN name = 'Demo Restaurant' THEN 'El Araguaney' ELSE name END
WHERE id = '11111111-1111-1111-1111-111111111111';

UPDATE venues SET name = 'Las Mercedes, Caracas'
WHERE id = '22222222-2222-2222-2222-222222222222' AND name = 'Las Mercedes';

UPDATE tables SET label = replace(label, 'Table ', 'Mesa ')
WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND label LIKE 'Table %';

INSERT INTO tables (tenant_id, venue_id, label, qr_token, pos_table_ref, is_active)
SELECT v.tenant_id, v.id, 'Mesa ' || n,
       rtrim(translate(encode(gen_random_bytes(16), 'base64'), '+/', '-_'), '='),
       'table-' || n, true
FROM venues v, generate_series(4, 6) AS n
WHERE v.id = '22222222-2222-2222-2222-222222222222'
ON CONFLICT (venue_id, pos_table_ref) DO NOTHING;

-- Bills left over from the in-memory mock POS, which this demo replaces.
UPDATE bills SET pos_status = 'closed', status = 'closed', updated_at = now()
WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND pos_status = 'open';

CREATE TABLE demo_menu_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID   NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category    TEXT   NOT NULL,
  name        TEXT   NOT NULL,
  -- In the restaurant's bill currency, before IVA and service.
  price_minor BIGINT NOT NULL CHECK (price_minor > 0),
  sort_order  INT    NOT NULL DEFAULT 0
);
CREATE INDEX demo_menu_items_tenant_idx ON demo_menu_items (tenant_id, sort_order);

CREATE TABLE demo_orders (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  table_id  UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  status    TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX demo_orders_one_open_per_table ON demo_orders (table_id) WHERE status = 'open';
CREATE INDEX demo_orders_tenant_idx ON demo_orders (tenant_id, status);

-- One row per portion, so that guests can each pay for their own.
CREATE TABLE demo_order_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID   NOT NULL REFERENCES demo_orders(id) ON DELETE CASCADE,
  tenant_id   UUID   NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT   NOT NULL,
  price_minor BIGINT NOT NULL CHECK (price_minor > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX demo_order_lines_order_idx ON demo_order_lines (order_id, created_at);

-- Keep these away from Supabase's public REST API, like every other table.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['demo_menu_items', 'demo_orders', 'demo_order_lines']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;

INSERT INTO demo_menu_items (tenant_id, category, name, price_minor, sort_order)
SELECT t.id, m.category, m.name, m.price_minor, m.sort_order
FROM tenants t,
(VALUES
  ('Entradas', 'Tequeños (6 u.)',            550,  1),
  ('Entradas', 'Empanada de carne mechada',  300,  2),
  ('Entradas', 'Arepitas con nata',          400,  3),
  ('Entradas', 'Ensalada de aguacate',       600,  4),
  ('Platos',   'Arepa reina pepiada',        650, 11),
  ('Platos',   'Arepa dominó',               550, 12),
  ('Platos',   'Cachapa con queso de mano',  800, 13),
  ('Platos',   'Pabellón criollo',          1200, 14),
  ('Platos',   'Asado negro',               1450, 15),
  ('Platos',   'Hallaca',                    700, 16),
  ('Platos',   'Parrilla mixta para dos',   3200, 17),
  ('Bebidas',  'Papelón con limón',          250, 21),
  ('Bebidas',  'Jugo de parchita',           300, 22),
  ('Bebidas',  'Malta',                      180, 23),
  ('Bebidas',  'Cerveza Polar',              200, 24),
  ('Bebidas',  'Café guayoyo',               150, 25),
  ('Postres',  'Quesillo',                   400, 31),
  ('Postres',  'Torta tres leches',          500, 32)
) AS m(category, name, price_minor, sort_order)
WHERE t.id = '11111111-1111-1111-1111-111111111111';
