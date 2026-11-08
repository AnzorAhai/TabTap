-- Database-level isolation between restaurants (Phase 6).
--
-- The API connects as the table owner, which row-level security doesn't apply to. While
-- it serves a request for one restaurant it now switches to this restricted role with
-- app.current_tenant_id set, so a query that forgets its tenant filter can't reach
-- another restaurant's rows. Guest pages, background jobs and the platform section work
-- across restaurants and keep the owner connection.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tabtap_app') THEN
    CREATE ROLE tabtap_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

GRANT tabtap_app TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO tabtap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tabtap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tabtap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tabtap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tabtap_app;

-- The restaurant's own row.
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_setting('app.current_tenant_id', true)::uuid);

-- Accounts belong to people, who can work at several restaurants. Who works where is
-- in memberships, which is isolated like the rest.
CREATE POLICY app_role_access ON users TO tabtap_app USING (true) WITH CHECK (true);
CREATE POLICY app_role_access ON sessions TO tabtap_app USING (true) WITH CHECK (true);
CREATE POLICY app_role_access ON user_invites TO tabtap_app USING (true) WITH CHECK (true);
