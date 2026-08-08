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
    await client.query("DELETE FROM receipts");
    await client.query("DELETE FROM payments");
    await client.query("DELETE FROM split_participants");
    await client.query("DELETE FROM splits");
    await client.query("UPDATE bills SET paid_minor = 0, status = 'open'");
    await client.query("COMMIT");
    console.log("Test data cleared, bills reset to open/unpaid.");
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
