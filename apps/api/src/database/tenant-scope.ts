import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";

/** The restricted database role of migration 0010; row-level security applies to it. */
const TENANT_ROLE = "tabtap_app";

const scopes = new AsyncLocalStorage<PoolClient>();

export interface TenantPool extends Pool {
  /**
   * Runs `fn` on one connection restricted to this restaurant: every query made through
   * the pool inside it, however deep, can only see and change that restaurant's rows.
   * Needs a session-level connection (Supabase's session pooler, not the transaction one).
   */
  runAsTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T>;
}

/** The scope's connection, safe for the concurrent queries a request may make. */
function scopedClient(client: PoolClient): PoolClient {
  let tail: Promise<unknown> = Promise.resolve();
  let inTransaction = false;
  const query = (text: string, values?: unknown[]) => {
    if (text === "BEGIN") {
      // On a shared connection the inner COMMIT would silently end the outer transaction.
      if (inTransaction) return Promise.reject(new Error("Nested transaction inside a tenant scope"));
      inTransaction = true;
    } else if (text === "COMMIT" || text === "ROLLBACK") {
      inTransaction = false;
    }
    const result = tail.then(() => client.query(text, values));
    tail = result.catch(() => undefined);
    return result;
  };
  return { query, release: () => undefined } as unknown as PoolClient;
}

/** Makes `pool` follow the tenant scope of the code calling it. Outside a scope it is unchanged. */
export function tenantAwarePool(pool: Pool): TenantPool {
  const ownerQuery = pool.query.bind(pool) as (...args: unknown[]) => unknown;
  const ownerConnect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;

  pool.query = ((...args: unknown[]) => {
    const scope = scopes.getStore();
    return scope ? scope.query(args[0] as string, args[1] as unknown[]) : ownerQuery(...args);
  }) as Pool["query"];

  pool.connect = ((...args: unknown[]) => {
    const scope = scopes.getStore();
    return scope ? Promise.resolve(scope) : ownerConnect(...args);
  }) as Pool["connect"];

  return Object.assign(pool, {
    async runAsTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
      const client = (await ownerConnect()) as PoolClient;
      const scope = scopedClient(client);
      try {
        await scope.query(`SELECT set_config('role', $1, false), set_config('app.current_tenant_id', $2, false)`, [
          TENANT_ROLE,
          tenantId,
        ]);
        return await scopes.run(scope, fn);
      } finally {
        // Not awaited: the response needn't wait for the connection to be cleaned. A connection
        // that can't be cleaned is destroyed, never reused with another restaurant's scope.
        scope.query("RESET ROLE; RESET app.current_tenant_id").then(
          () => client.release(),
          (err: Error) => client.release(err),
        );
      }
    },
  });
}
