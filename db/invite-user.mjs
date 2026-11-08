// Creates (or finds) a staff account and prints a one-time link to set its password.
// This is how the very first person gets in; after that, invites go through the admin
// panel. Also works as a password reset for an existing account.
//
//   npm run users:invite -- --email you@example.com --platform-admin \
//     --tenant 11111111-1111-1111-1111-111111111111 --role owner \
//     --admin-url https://tab-tap-admin.vercel.app
//
// Uses DATABASE_URL (from apps/api/.env when present) — point it at the database you mean.
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import pg from "pg";

const INVITE_TTL_HOURS = 72;

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    "platform-admin": { type: "boolean", default: false },
    tenant: { type: "string" },
    role: { type: "string", default: "owner" },
    "admin-url": { type: "string" },
  },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

const email = values.email?.trim().toLowerCase();
if (!email || !email.includes("@")) fail("--email is required");
if (!["owner", "manager", "waiter"].includes(values.role)) fail("--role must be owner, manager or waiter");
if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set");
const adminUrl = (values["admin-url"] ?? process.env.ADMIN_APP_URL ?? "http://localhost:5174").replace(/\/+$/, "");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const { rows } = await client.query(
    `INSERT INTO users (email, is_platform_admin) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET is_platform_admin = users.is_platform_admin OR EXCLUDED.is_platform_admin,
                                       updated_at = now()
     RETURNING id, password_hash IS NOT NULL AS has_password, is_platform_admin`,
    [email, values["platform-admin"]],
  );
  const user = rows[0];

  if (values.tenant) {
    const tenant = await client.query("SELECT name FROM tenants WHERE id = $1", [values.tenant]);
    if (tenant.rowCount === 0) throw new Error(`No restaurant with id ${values.tenant}`);
    await client.query(
      `INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role`,
      [user.id, values.tenant, values.role],
    );
    console.log(`${email} is ${values.role} of "${tenant.rows[0].name}".`);
  }
  if (user.is_platform_admin) console.log(`${email} is a platform admin.`);

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest();
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000);
  await client.query("DELETE FROM user_invites WHERE user_id = $1 AND used_at IS NULL", [user.id]);
  await client.query(`INSERT INTO user_invites (user_id, token_hash, purpose, expires_at) VALUES ($1, $2, $3, $4)`, [
    user.id,
    tokenHash,
    user.has_password ? "password_reset" : "invite",
    expiresAt,
  ]);
  await client.query("COMMIT");

  console.log(
    `\nOpen this link to ${user.has_password ? "set a new" : "choose a"} password (valid until ${expiresAt.toISOString()}):`,
  );
  console.log(`${adminUrl}/invite/${token}\n`);
} catch (err) {
  await client.query("ROLLBACK");
  fail(err instanceof Error ? err.message : String(err));
} finally {
  client.release();
  await pool.end();
}
