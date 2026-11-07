import type { Pool, PoolClient } from "pg";

/** Anything that can run a query: the pool itself, or a client inside a transaction. */
export type Queryable = Pick<Pool | PoolClient, "query">;

/** Runs `fn` in a transaction on one pooled connection; rolls back if it throws. */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
