import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Passwords: scrypt (memory-hard, built into Node — no native dependency to build on
// Render or Windows). Stored as "scrypt$N$r$p$salt$hash" so parameters can be raised later.
const SCRYPT = { N: 32768, r: 8, p: 1 };
const KEY_LENGTH = 64;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

function scryptAsync(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  const maxmem = 256 * options.N! * options.r!;
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, { ...options, maxmem }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize("NFKC"), salt, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scryptAsync(password.normalize("NFKC"), Buffer.from(salt, "base64url"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | undefined;
/**
 * Spends the same time as checking a real password, so a login attempt for an unknown
 * email can't be told apart from a wrong password by how long it takes.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("not-a-real-password");
  await verifyPassword(password, await dummyHash);
}

/** Bearer tokens for sessions and invite links: 256 random bits; only the hash is stored. */
export function newSecretToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashSecretToken(token) };
}

export function hashSecretToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

/** Table QR tokens: 128 random bits, URL-safe (22 characters). */
export function newQrToken(): string {
  return randomBytes(16).toString("base64url");
}
