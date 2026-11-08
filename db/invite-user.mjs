// Creates (or finds) a staff account. This is how the very first person gets in; after
// that, invites go through the admin panel. Also resets the password of an existing account.
//
// With --password the account is ready to use at once:
//   npm run users:invite -- --login admin --password "a long password" --platform-admin \
//     --tenant 11111111-1111-1111-1111-111111111111 --role owner \
//     --admin-url https://tab-tap-admin.vercel.app
// Without it, prints a one-time link where the person chooses their own password.
//
// Uses DATABASE_URL (from apps/api/.env when present) — point it at the database you mean.
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { parseArgs } from "node:util";
import pg from "pg";

const INVITE_TTL_HOURS = 72;
const RECOMMENDED_PASSWORD_LENGTH = 10;

const { values } = parseArgs({
  options: {
    login: { type: "string" },
    password: { type: "string" },
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

/** Same format as apps/api/src/auth/crypto.ts, which is what checks it at sign-in. */
function hashPassword(password) {
  const [N, r, p] = [32768, 8, 1];
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize("NFKC"), salt, 64, { N, r, p, maxmem: 256 * N * r });
  return ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

const login = values.login?.trim().toLowerCase();
if (!login) fail("--login is required");
if (values.password === "") fail("--password can't be empty");
if (!["owner", "manager", "waiter"].includes(values.role)) fail("--role must be owner, manager or waiter");
if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set");
const adminUrl = (values["admin-url"] ?? process.env.ADMIN_APP_URL ?? "http://localhost:5174").replace(/\/+$/, "");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const { rows } = await client.query(
    `INSERT INTO users (login, is_platform_admin) VALUES ($1, $2)
     ON CONFLICT (login) DO UPDATE SET is_platform_admin = users.is_platform_admin OR EXCLUDED.is_platform_admin,
                                       updated_at = now()
     RETURNING id, password_hash IS NOT NULL AS has_password, is_platform_admin`,
    [login, values["platform-admin"]],
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
    console.log(`${login} is ${values.role} of "${tenant.rows[0].name}".`);
  }
  if (user.is_platform_admin) console.log(`${login} is a platform admin.`);

  await client.query("DELETE FROM user_invites WHERE user_id = $1 AND used_at IS NULL", [user.id]);

  if (values.password !== undefined) {
    await client.query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [
      user.id,
      hashPassword(values.password),
    ]);
    // A new password signs out every other device.
    await client.query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
    await client.query("COMMIT");
    if (values.password.length < RECOMMENDED_PASSWORD_LENGTH) {
      console.warn("\nWarning: this password is short and easy to guess. Change it before real money is involved.");
    }
    console.log(`\nSign in at ${adminUrl} with the login "${login}".\n`);
  } else {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest();
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000);
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
  }
} catch (err) {
  await client.query("ROLLBACK");
  fail(err instanceof Error ? err.message : String(err));
} finally {
  client.release();
  await pool.end();
}
