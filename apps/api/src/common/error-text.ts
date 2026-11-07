/** Message of anything thrown, for logs. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
