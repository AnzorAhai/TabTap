import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, DEMO_TENANT_ID, type TestApp } from "./support/test-app";

// db/invite-user.mjs hashes passwords itself, so these prove the API can check what it writes.

const run = promisify(execFile);
const SCRIPT = path.resolve("../../db/invite-user.mjs");

describe("users:invite", () => {
  let t: TestApp;
  beforeEach(async () => (t = await createTestApp()));
  afterEach(() => t.close());

  const invite = (...args: string[]) =>
    run(process.execPath, [SCRIPT, ...args], { env: { ...process.env, DATABASE_URL: t.config.databaseUrl } });
  const signIn = (login: string, password: string) => t.http().post("/auth/login").send({ login, password });

  it("creates an account that can sign in straight away with the given password", async () => {
    const { stdout } = await invite(
      "--login",
      "Admin",
      "--password",
      "a long enough password",
      "--platform-admin",
      "--tenant",
      DEMO_TENANT_ID,
      "--role",
      "owner",
    );
    expect(stdout).not.toContain("/invite/");

    const res = await signIn("admin", "a long enough password").expect(200);
    expect(res.body.me).toMatchObject({
      login: "admin",
      isPlatformAdmin: true,
      memberships: [{ tenantId: DEMO_TENANT_ID, role: "owner" }],
    });
    await signIn("admin", "something else").expect(401);
  });

  it("accepts a short password on request and warns about it", async () => {
    const { stderr } = await invite("--login", "admin", "--password", "admin");
    expect(stderr).toMatch(/short/);
    await signIn("admin", "admin").expect(200);
  });

  it("replaces the password of an existing account and signs it out everywhere", async () => {
    const session = await t.signIn({ login: "owner@demo.test", role: "owner" });
    await invite("--login", "owner@demo.test", "--password", "a brand new password");
    await t.http().get("/auth/me").set("Authorization", `Bearer ${session.token}`).expect(401);
    await signIn("owner@demo.test", "a brand new password").expect(200);
  });

  it("prints a one-time link when no password is given", async () => {
    const { stdout } = await invite("--login", "newcomer", "--admin-url", "https://admin.example");
    const token = /https:\/\/admin\.example\/invite\/([\w-]+)/.exec(stdout)![1];
    await t.http().post(`/auth/invites/${token}/accept`).send({ password: "a long enough password" }).expect(200);
    await signIn("newcomer", "a long enough password").expect(200);
  });

  it("refuses a login with spaces", async () => {
    await expect(invite("--login", "two words", "--password", "a long enough password")).rejects.toThrow();
  });
});
