import pg from "pg";

const { Pool } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Receipts and POS sync jobs go with their payments (ON DELETE CASCADE).
    await client.query("DELETE FROM payments");
    await client.query("DELETE FROM equal_splits");
    await client.query("UPDATE bills SET paid_minor = 0, status = 'open', updated_at = now()");
    await client.query("COMMIT");
    console.log("Payments and equal splits deleted, bills reopened as unpaid.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
