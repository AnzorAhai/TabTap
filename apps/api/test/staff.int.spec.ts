import type { InviteStaffResult, SessionView, StaffMemberView } from "@tabtap/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, DEMO_TENANT_ID, TEST_PASSWORD, type TestApp } from "./support/test-app";

// Admin panel access over HTTP against a real PostgreSQL (fresh database per test).

const bearer = (session: SessionView) => ({ Authorization: `Bearer ${session.token}` });
const tokenFromLink = (url: string) => url.split("/invite/")[1];

describe("signing in", () => {
  let t: TestApp;
  beforeEach(async () => (t = await createTestApp()));
  afterEach(() => t.close());

  it("signs in with login and password and shows who you are", async () => {
    const session = await t.signIn({ login: "Owner@Demo.test".toLowerCase(), role: "owner" });
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.me).toMatchObject({
      login: "owner@demo.test",
      isPlatformAdmin: false,
      memberships: [{ tenantId: DEMO_TENANT_ID, tenantName: "El Araguaney", role: "owner" }],
    });

    const me = await t.http().get("/auth/me").set(bearer(session)).expect(200);
    expect(me.body.login).toBe("owner@demo.test");
    // Email is matched case-insensitively.
    await t.http().post("/auth/login").send({ login: "OWNER@demo.TEST", password: TEST_PASSWORD }).expect(200);
  });

  it("gives the same answer for a wrong password and an unknown login", async () => {
    await t.signIn({ login: "owner@demo.test", role: "owner" });
    const wrong = await t.http().post("/auth/login").send({ login: "owner@demo.test", password: "nope-nope-nope" });
    const unknown = await t.http().post("/auth/login").send({ login: "who@demo.test", password: "nope-nope-nope" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it("rejects missing, invalid, signed-out and expired sessions", async () => {
    await t.http().get("/auth/me").expect(401);
    await t.http().get("/auth/me").set("Authorization", "Bearer not-a-real-token").expect(401);

    const session = await t.signIn({ login: "owner@demo.test", role: "owner" });
    await t.http().post("/auth/logout").set(bearer(session)).expect(204);
    await t.http().get("/auth/me").set(bearer(session)).expect(401);

    const again = (await t.http().post("/auth/login").send({ login: "owner@demo.test", password: TEST_PASSWORD }))
      .body as SessionView;
    await t.db.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    await t.http().get("/auth/me").set(bearer(again)).expect(401);
  });

  it("locks out disabled accounts immediately", async () => {
    const session = await t.signIn({ login: "owner@demo.test", role: "owner" });
    await t.db.query("UPDATE users SET is_active = false");
    await t.http().get("/auth/me").set(bearer(session)).expect(401);
    await t.http().post("/auth/login").send({ login: "owner@demo.test", password: TEST_PASSWORD }).expect(401);
  });
});

describe("inviting staff", () => {
  let t: TestApp;
  let owner: SessionView;
  beforeEach(async () => {
    t = await createTestApp();
    owner = await t.signIn({ login: "owner@demo.test", role: "owner" });
  });
  afterEach(() => t.close());

  const invite = (session: SessionView, body: object) =>
    t.http().post(`/tenants/${DEMO_TENANT_ID}/staff`).set(bearer(session)).send(body);

  it("takes a plain login, not only an email address, and refuses malformed ones", async () => {
    const res = await invite(owner, { login: "Maria.P", role: "waiter" });
    expect(res.status).toBe(201);
    expect((res.body as InviteStaffResult).member.login).toBe("maria.p");

    expect((await invite(owner, { login: "two words", role: "waiter" })).status).toBe(400);
    expect((await invite(owner, { login: "ab", role: "waiter" })).status).toBe(400);
  });

  it("creates a one-time link with which the new person sets a password and is signed in", async () => {
    const res = await invite(owner, { login: "Waiter@Demo.test", role: "waiter", name: "Ana" });
    expect(res.status).toBe(201);
    const result = res.body as InviteStaffResult;
    expect(result.member).toMatchObject({ login: "waiter@demo.test", role: "waiter", status: "invited" });
    expect(result.inviteLink!.url).toMatch(/^http:\/\/localhost:5174\/invite\/[A-Za-z0-9_-]{43}$/);

    const token = tokenFromLink(result.inviteLink!.url);
    const info = await t.http().get(`/auth/invites/${token}`).expect(200);
    expect(info.body).toMatchObject({ login: "waiter@demo.test", name: "Ana", purpose: "invite" });

    await t.http().post(`/auth/invites/${token}/accept`).send({ password: "short" }).expect(400);
    const accepted = await t
      .http()
      .post(`/auth/invites/${token}/accept`)
      .send({ password: "a long enough password" })
      .expect(200);
    expect((accepted.body as SessionView).me.memberships).toEqual([
      { tenantId: DEMO_TENANT_ID, tenantName: "El Araguaney", role: "waiter" },
    ]);

    // The link works once.
    await t.http().post(`/auth/invites/${token}/accept`).send({ password: "another long password" }).expect(410);
    await t.http().get(`/auth/invites/${token}`).expect(410);
    await t
      .http()
      .post("/auth/login")
      .send({ login: "waiter@demo.test", password: "a long enough password" })
      .expect(200);

    const staff = await t.http().get(`/tenants/${DEMO_TENANT_ID}/staff`).set(bearer(owner)).expect(200);
    expect((staff.body as StaffMemberView[]).find((m) => m.login === "waiter@demo.test")!.status).toBe("active");
  });

  it("expires links and replaces old ones when a new link is issued", async () => {
    const first = (await invite(owner, { login: "w@demo.test", role: "waiter" })).body as InviteStaffResult;
    const relink = await t
      .http()
      .post(`/tenants/${DEMO_TENANT_ID}/staff/${first.member.userId}/invite-link`)
      .set(bearer(owner))
      .expect(200);
    await t
      .http()
      .get(`/auth/invites/${tokenFromLink(first.inviteLink!.url)}`)
      .expect(410);

    await t.db.query("UPDATE user_invites SET expires_at = now() - interval '1 second'");
    await t
      .http()
      .get(`/auth/invites/${tokenFromLink(relink.body.url as string)}`)
      .expect(410);
  });

  it("doesn't issue a link for someone who already has an account", async () => {
    const other = await t.signIn({ login: "chef@other.test" });
    const res = await invite(owner, { login: "chef@other.test", role: "manager" });
    expect(res.status).toBe(201);
    expect((res.body as InviteStaffResult).inviteLink).toBeNull();
    await t
      .http()
      .post(`/tenants/${DEMO_TENANT_ID}/staff/${other.me.userId}/invite-link`)
      .set(bearer(owner))
      .expect(409);
    expect((await invite(owner, { login: "chef@other.test", role: "waiter" })).status).toBe(409);
  });

  it("lets managers handle waiters only, and keeps at least one owner", async () => {
    const manager = await t.signIn({ login: "manager@demo.test", role: "manager" });
    expect((await invite(manager, { login: "w@demo.test", role: "waiter" })).status).toBe(201);
    expect((await invite(manager, { login: "m2@demo.test", role: "manager" })).status).toBe(403);

    const staffUrl = `/tenants/${DEMO_TENANT_ID}/staff`;
    await t.http().patch(`${staffUrl}/${owner.me.userId}`).set(bearer(manager)).send({ role: "waiter" }).expect(403);
    await t.http().delete(`${staffUrl}/${owner.me.userId}`).set(bearer(manager)).expect(403);
    await t.http().patch(`${staffUrl}/${owner.me.userId}`).set(bearer(owner)).send({ role: "manager" }).expect(409);
    await t.http().delete(`${staffUrl}/${owner.me.userId}`).set(bearer(owner)).expect(409);

    await t.http().patch(`${staffUrl}/${manager.me.userId}`).set(bearer(owner)).send({ role: "owner" }).expect(200);
    await t.http().patch(`${staffUrl}/${owner.me.userId}`).set(bearer(owner)).send({ role: "waiter" }).expect(200);
    // Losing the role takes effect on the very next request.
    await t.http().get(staffUrl).set(bearer(owner)).expect(403);
  });
});

describe("restaurant management", () => {
  let t: TestApp;
  beforeEach(async () => (t = await createTestApp()));
  afterEach(() => t.close());

  it("never shows or changes another restaurant's data", async () => {
    const outsider = await t.signIn({ login: "x@other.test" });
    await t.http().get(`/tenants/${DEMO_TENANT_ID}/tables`).set(bearer(outsider)).expect(403);
    await t.http().get(`/tenants/${DEMO_TENANT_ID}/payments`).set(bearer(outsider)).expect(403);

    // A table id from another restaurant is not found through your own restaurant.
    const { rows } = await t.db.query(
      `INSERT INTO tenants (name, country, default_currency) VALUES ('Other', 'VE', 'USD') RETURNING id`,
    );
    const otherTenant = rows[0].id as string;
    const otherOwner = await t.signIn({ login: "owner@other.test", role: "owner", tenantId: otherTenant });
    const demoTable = (await t.db.query("SELECT id FROM tables LIMIT 1")).rows[0].id as string;
    await t
      .http()
      .patch(`/tenants/${otherTenant}/tables/${demoTable}`)
      .set(bearer(otherOwner))
      .send({ label: "Mine now" })
      .expect(404);
  });

  it("manages tables: create, rename, disable and rotate the QR code", async () => {
    const owner = await t.signIn({ login: "owner@demo.test", role: "owner" });
    const waiter = await t.signIn({ login: "waiter@demo.test", role: "waiter" });
    const base = `/tenants/${DEMO_TENANT_ID}`;
    const venueId = ((await t.http().get(`${base}/venues`).set(bearer(waiter)).expect(200)).body as { id: string }[])[0]
      .id;

    await t
      .http()
      .post(`${base}/tables`)
      .set(bearer(waiter))
      .send({ venueId, label: "T4", posTableRef: "t4" })
      .expect(403);
    const created = await t
      .http()
      .post(`${base}/tables`)
      .set(bearer(owner))
      .send({ venueId, label: "Terraza 4", posTableRef: "table-40" })
      .expect(201);
    expect(created.body).toMatchObject({ label: "Terraza 4", posTableRef: "table-40", isActive: true });
    expect(created.body.guestUrl).toBe(`http://localhost:5173/?table=${created.body.qrToken}`);
    await t
      .http()
      .post(`${base}/tables`)
      .set(bearer(owner))
      .send({ venueId, label: "Dup", posTableRef: "table-40" })
      .expect(409);

    // Rotating the QR code: the old token stops working for guests at once.
    const table1 = (await t.http().get(`${base}/tables`).set(bearer(waiter)).expect(200)).body.find(
      (x: { posTableRef: string }) => x.posTableRef === "table-1",
    );
    await t.http().get(`/tables/${table1.qrToken}/bill`).expect(200);
    const rotated = await t.http().post(`${base}/tables/${table1.id}/rotate-qr`).set(bearer(owner)).expect(200);
    expect(rotated.body.qrToken).not.toBe(table1.qrToken);
    await t.http().get(`/tables/${table1.qrToken}/bill`).expect(404);
    await t.http().get(`/tables/${rotated.body.qrToken}/bill`).expect(200);

    // A disabled table can't be opened by guests.
    await t.http().patch(`${base}/tables/${table1.id}`).set(bearer(owner)).send({ isActive: false }).expect(200);
    await t.http().get(`/tables/${rotated.body.qrToken}/bill`).expect(404);
  });

  it("updates payment settings; only the owner renames the restaurant", async () => {
    const owner = await t.signIn({ login: "owner@demo.test", role: "owner" });
    const manager = await t.signIn({ login: "manager@demo.test", role: "manager" });
    const url = `/tenants/${DEMO_TENANT_ID}/settings`;

    const res = await t
      .http()
      .patch(url)
      .set(bearer(manager))
      .send({ name: "Hacked", tipPercentOptions: [15, 0, 10, 10], rateSource: "manual" })
      .expect(200);
    expect(res.body).toMatchObject({
      name: "El Araguaney",
      tipPercentOptions: [0, 10, 15],
      rateSource: "manual",
      role: "manager",
    });
    await t
      .http()
      .patch(url)
      .set(bearer(manager))
      .send({ tipPercentOptions: [80] })
      .expect(400);

    await t.http().patch(url).set(bearer(owner)).send({ name: "La Casa" }).expect(200);
    expect((await t.tableView()).bill.tenantName).toBe("La Casa");
    expect((await t.tableView()).tipPercentOptions).toEqual([0, 10, 15]);
  });
});

describe("platform admin", () => {
  let t: TestApp;
  beforeEach(async () => (t = await createTestApp()));
  afterEach(() => t.close());

  it("onboards a restaurant with its owner, sets the fee and can suspend it", async () => {
    const owner = await t.signIn({ login: "owner@demo.test", role: "owner" });
    const admin = await t.signIn({ login: "ops@tabtap.test", platformAdmin: true });
    const body = {
      name: "Arepera Altamira",
      country: "VE",
      defaultCurrency: "USD",
      venueName: "Altamira",
      timezone: "America/Caracas",
      ownerLogin: "Dueno@Altamira.test",
    };

    await t.http().post("/platform/tenants").set(bearer(owner)).send(body).expect(403);
    await t
      .http()
      .post("/platform/tenants")
      .set(bearer(admin))
      .send({ ...body, timezone: "Mars/Olympus" })
      .expect(400);
    const created = await t.http().post("/platform/tenants").set(bearer(admin)).send(body).expect(201);
    expect(created.body.tenant).toMatchObject({ name: "Arepera Altamira", platformFeeBps: 150, status: "active" });
    expect(created.body.tenant.ownerLogins).toEqual(["dueno@altamira.test"]);

    const tenantId = created.body.tenant.id as string;
    const accepted = await t
      .http()
      .post(`/auth/invites/${tokenFromLink(created.body.ownerInvite.url as string)}/accept`)
      .send({ password: "owner password 123" })
      .expect(200);
    expect(accepted.body.me.memberships).toEqual([{ tenantId, tenantName: "Arepera Altamira", role: "owner" }]);

    // Platform admins act as owners everywhere; restaurants can't change their own fee.
    await t.http().get(`/tenants/${tenantId}/tables`).set(bearer(admin)).expect(200);
    const fee = await t
      .http()
      .patch(`/platform/tenants/${tenantId}`)
      .set(bearer(admin))
      .send({ platformFeeBps: 120 })
      .expect(200);
    expect(fee.body.platformFeeBps).toBe(120);
    await t.http().patch(`/platform/tenants/${tenantId}`).set(bearer(admin)).send({ platformFeeBps: 5000 }).expect(400);

    // Suspending the demo restaurant closes its tables to guests.
    await t
      .http()
      .patch(`/platform/tenants/${DEMO_TENANT_ID}`)
      .set(bearer(admin))
      .send({ status: "suspended" })
      .expect(200);
    await t
      .http()
      .get(`/tables/${await t.qrToken("table-1")}/bill`)
      .expect(404);

    const list = await t.http().get("/platform/tenants").set(bearer(admin)).expect(200);
    expect(list.body).toHaveLength(2);
  });

  it("issues password reset links that sign out the old sessions", async () => {
    const admin = await t.signIn({ login: "ops@tabtap.test", platformAdmin: true });
    const owner = await t.signIn({ login: "owner@demo.test", role: "owner" });
    const link = await t
      .http()
      .post("/platform/password-links")
      .set(bearer(admin))
      .send({ login: "owner@demo.test" })
      .expect(200);
    const token = tokenFromLink(link.body.url as string);
    expect((await t.http().get(`/auth/invites/${token}`).expect(200)).body.purpose).toBe("password_reset");
    await t.http().post(`/auth/invites/${token}/accept`).send({ password: "brand new password" }).expect(200);
    await t.http().get("/auth/me").set(bearer(owner)).expect(401);
    await t.http().post("/auth/login").send({ login: "owner@demo.test", password: TEST_PASSWORD }).expect(401);
  });
});
