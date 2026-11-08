// Load test of the guest money path. LOCAL ONLY: it deletes every payment in the database.
//
// Needs the API on localhost with POS_CONNECTOR_TYPE=mock and RATE_LIMIT_ENABLED=false, then:
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/tabtap node db/load-test.mjs
//
// Measures reading bills under load, then has guests fight over the same things and checks
// that nothing was sold twice and the money adds up.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const API = process.env.API_URL ?? "http://localhost:3000";
const READ_SECONDS = Number(process.env.READ_SECONDS ?? 15);
const READ_CONCURRENCY = Number(process.env.READ_CONCURRENCY ?? 50);
const RACERS = Number(process.env.RACERS ?? 30);

const isLocal = (url) => ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
if (!process.env.DATABASE_URL || !isLocal(process.env.DATABASE_URL) || !isLocal(API)) {
  console.error("Refusing to run: DATABASE_URL and API_URL must both point at localhost.");
  process.exit(1);
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function http(method, path, body, headers = {}) {
  const started = performance.now();
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, ms: performance.now() - started };
}

const pay = (billId, body) => http("POST", `/bills/${billId}/payments`, body, { "Idempotency-Key": randomUUID() });

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

function summarize(name, results) {
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const statuses = Object.groupBy(results, (r) => r.status);
  const counts = Object.entries(statuses)
    .map(([status, list]) => `${status}×${list.length}`)
    .join(" ");
  const fmt = (v) => `${Math.round(v)}ms`;
  console.log(
    `${name.padEnd(26)} n=${String(results.length).padEnd(6)} p50=${fmt(percentile(ms, 50)).padEnd(8)} ` +
      `p95=${fmt(percentile(ms, 95)).padEnd(8)} p99=${fmt(percentile(ms, 99)).padEnd(8)} ${counts}`,
  );
}

const race = (n, attempt) => Promise.all(Array.from({ length: n }, attempt));
const count = (results, status) => results.filter((r) => r.status === status).length;

let failures = 0;
function check(condition, message) {
  console.log(`  ${condition ? "ok  " : "FAIL"} ${message}`);
  if (!condition) failures += 1;
}

async function main() {
  await db.query("DELETE FROM payments");
  await db.query("DELETE FROM equal_splits");
  await db.query("UPDATE bills SET paid_minor = 0, status = 'open', updated_at = now()");
  const { rows } = await db.query(
    `SELECT pos_table_ref, qr_token FROM tables WHERE pos_table_ref IN ('table-1', 'table-2', 'table-3')`,
  );
  const token = Object.fromEntries(rows.map((r) => [r.pos_table_ref, r.qr_token]));
  const billOf = async (table) => (await http("GET", `/tables/${token[table]}/bill`)).json;

  const views = await Promise.all(["table-1", "table-2", "table-3"].map(billOf));
  if (views.some((v) => !v?.bill)) throw new Error("No bills: is the API running with POS_CONNECTOR_TYPE=mock?");
  const [one, two, three] = views;

  // 1. Many guests reading bills.
  const reads = [];
  const until = Date.now() + READ_SECONDS * 1000;
  await Promise.all(
    Array.from({ length: READ_CONCURRENCY }, async () => {
      while (Date.now() < until) reads.push(await http("GET", `/tables/${token["table-1"]}/bill`));
    }),
  );
  summarize("read bill", reads);
  console.log(`  ${Math.round(reads.length / READ_SECONDS)} requests/second with ${READ_CONCURRENCY} at once`);

  // Staff screens and guests at once: each staff request holds a restricted connection.
  const staffToken = randomBytes(32).toString("base64url");
  const staff = await db.query(
    `INSERT INTO users (login, is_platform_admin) VALUES ('load-test', true)
     ON CONFLICT (login) DO UPDATE SET updated_at = now() RETURNING id`,
  );
  await db.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [
    staff.rows[0].id,
    createHash("sha256").update(staffToken).digest(),
  ]);
  const { rows: tenant } = await db.query(`SELECT tenant_id FROM tables WHERE qr_token = $1`, [token["table-1"]]);
  const staffPath = `/tenants/${tenant[0].tenant_id}/tables/live`;
  const auth = { Authorization: `Bearer ${staffToken}` };
  const staffReads = [];
  const guestReads = [];
  const mixedUntil = Date.now() + READ_SECONDS * 1000;
  const worker = async (list, call) => {
    while (Date.now() < mixedUntil) list.push(await call());
  };
  await Promise.all(
    Array.from({ length: READ_CONCURRENCY }, (_, i) =>
      i % 2
        ? worker(staffReads, () => http("GET", staffPath, undefined, auth))
        : worker(guestReads, () => http("GET", `/tables/${token["table-1"]}/bill`)),
    ),
  );
  summarize("staff screen, mixed load", staffReads);
  summarize("guest bill, mixed load", guestReads);
  await db.query(`DELETE FROM users WHERE login = 'load-test'`);

  // 2. Everyone wants the same dish.
  const item = one.bill.items[0];
  const itemRace = await race(RACERS, () => pay(one.bill.id, { mode: "items", itemIds: [item.id], method: "card" }));
  summarize("race for one dish", itemRace);
  check(count(itemRace, 201) === 1, "exactly one guest got the dish");
  check(count(itemRace, 409) === RACERS - 1, "everyone else was told it's taken");

  // 3. Everyone pays the whole bill at once.
  const fullRace = await race(RACERS, () => pay(two.bill.id, { mode: "full", method: "card" }));
  summarize("race for the whole bill", fullRace);
  check(count(fullRace, 201) === 1, "the bill was paid once");

  // 4. More guests than shares.
  await http("PUT", `/bills/${three.bill.id}/equal-split`, { shareCount: 10 });
  const shareRace = await race(RACERS, () => pay(three.bill.id, { mode: "shares", shareCount: 1, method: "card" }));
  summarize("race for 10 shares", shareRace);
  check(count(shareRace, 201) === 10, "exactly 10 shares were sold");

  // 5. The books.
  const books = await db.query(
    `SELECT b.id, b.paid_minor, b.total_minor,
            COALESCE(sum(p.amount_minor) FILTER (WHERE p.status = 'succeeded'), 0) AS settled
     FROM bills b LEFT JOIN payments p ON p.bill_id = b.id
     WHERE b.id = ANY($1) GROUP BY b.id`,
    [[one.bill.id, two.bill.id, three.bill.id]],
  );
  for (const row of books.rows) {
    check(
      Number(row.paid_minor) === Number(row.settled),
      `bill total recorded matches its payments (${row.paid_minor})`,
    );
    check(Number(row.paid_minor) <= Number(row.total_minor), "nothing was overpaid");
  }
  const everything = [...reads, ...staffReads, ...guestReads, ...itemRace, ...fullRace, ...shareRace];
  const errors = everything.filter((r) => r.status >= 500).length;
  check(errors === 0, "no server errors");

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.end());
