-- Staff accounts and access (Phase 2).
--
-- People sign in to the admin panel with email + password. A user belongs to one or
-- more restaurants (tenants) with a role; platform admins (TabTap staff) manage all
-- restaurants. Accounts are created by invitation: the inviter gets a one-time link
-- to pass on, and the invitee sets their own password through it. Only hashes of
-- session and invite tokens are stored.

CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT NOT NULL CHECK (email = lower(email) AND email LIKE '%_@_%'),
  name              TEXT NOT NULL DEFAULT '',
  -- NULL until the user accepts their invite and sets a password.
  password_hash     TEXT,
  is_platform_admin BOOLEAN NOT NULL DEFAULT false,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE memberships (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- owner: everything incl. staff; manager: tables, rates, settings, waiters; waiter: read-only.
  role       TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'waiter')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE INDEX memberships_tenant_idx ON memberships (tenant_id);

CREATE TABLE sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 of the bearer token handed to the client.
  token_hash   BYTEA NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent   TEXT,
  ip           TEXT
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE user_invites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  -- invite: first password; password_reset: a new one (same flow, other wording).
  purpose    TEXT NOT NULL CHECK (purpose IN ('invite', 'password_reset')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

CREATE INDEX user_invites_user_idx ON user_invites (user_id);

ALTER TABLE tenants ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE venues ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE tables ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX tables_venue_pos_ref_key ON tables (venue_id, pos_table_ref);

-- QR tokens were readable words ("table-1"), so anyone could open any table's bill by
-- guessing. Give every table a random 128-bit token. Printed QR codes of the demo
-- tables change with this; the admin panel shows the new ones.
UPDATE tables
SET qr_token = rtrim(translate(encode(gen_random_bytes(16), 'base64'), '+/', '-_'), '='),
    updated_at = now()
WHERE length(qr_token) < 20;

-- Supabase exposes the public schema through its REST API. Tables without RLS would
-- be readable there; enabling RLS with no permissive policy closes them to everyone
-- but the table owner (the API's connection). memberships is tenant-scoped like the rest.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
