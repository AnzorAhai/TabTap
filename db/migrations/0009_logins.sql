-- Staff sign in with a plain login instead of an email address. Nothing ever emailed them:
-- invitations are links the inviter passes on. Existing addresses stay valid as logins.

ALTER TABLE users DROP CONSTRAINT users_email_check;
ALTER TABLE users RENAME COLUMN email TO login;
ALTER INDEX users_email_key RENAME TO users_login_key;
ALTER TABLE users ADD CONSTRAINT users_login_check
  CHECK (login = lower(login) AND login ~ '^[a-z0-9._@-]{3,254}$');
