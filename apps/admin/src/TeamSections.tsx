import type { InviteLinkView, PlatformTenantView, StaffRole } from "@tabtap/shared";
import { useCallback, useState, type FormEvent } from "react";
import { api } from "./api";
import { useI18n } from "./i18n";
import { FeeTable } from "./PaymentSettings";
import { currentMonth, ErrorText, InviteLinkBox, useAction, useDialogs, useLoad } from "./ui";

export function StaffSection({ tenantId, role, myUserId }: { tenantId: string; role: StaffRole; myUserId: string }) {
  const { t, dateTime } = useI18n();
  const load = useCallback(() => api.staff(tenantId), [tenantId]);
  const staff = useLoad(load);
  const action = useAction();
  const dialogs = useDialogs();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [newRole, setNewRole] = useState<StaffRole>("waiter");
  const [link, setLink] = useState<InviteLinkView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const assignable: StaffRole[] = role === "owner" ? ["owner", "manager", "waiter"] : ["waiter"];

  function invite(e: FormEvent) {
    e.preventDefault();
    void action.run(async () => {
      const result = await api.inviteStaff(tenantId, { email, name, role: newRole });
      setLink(result.inviteLink);
      setNotice(result.inviteLink ? null : t.alreadyHasAccount(result.member.email));
      setEmail("");
      setName("");
      staff.reload();
    });
  }

  async function remove(userId: string, memberEmail: string) {
    const ok = await dialogs.confirm({ title: t.removeTitle(memberEmail), confirmLabel: t.remove, danger: true });
    if (!ok) return;
    void action.run(async () => {
      await api.removeStaff(tenantId, userId);
      staff.reload();
    });
  }

  return (
    <>
      <h1>{t.staffTitle}</h1>
      <section>
        <ErrorText error={staff.error ?? action.error} />
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.colEmail}</th>
                <th>{t.colName}</th>
                <th>{t.colRole}</th>
                <th>{t.colStatus}</th>
                <th>{t.colLastLogin}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(staff.data ?? []).map((m) => {
                const manageable = role === "owner" || (role === "manager" && m.role === "waiter");
                return (
                  <tr key={m.userId}>
                    <td>{m.email}</td>
                    <td>{m.name || "—"}</td>
                    <td>
                      {role === "owner" ? (
                        <select
                          aria-label={t.colRole}
                          value={m.role}
                          disabled={action.busy}
                          onChange={(e) =>
                            void action.run(async () => {
                              await api.changeRole(tenantId, m.userId, e.target.value as StaffRole);
                              staff.reload();
                            })
                          }
                        >
                          {(["owner", "manager", "waiter"] as StaffRole[]).map((r) => (
                            <option key={r} value={r}>
                              {t.role[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        t.role[m.role]
                      )}
                    </td>
                    <td>{t.staffStatus[m.status]}</td>
                    <td>{m.lastLoginAt ? dateTime(m.lastLoginAt) : "—"}</td>
                    <td className="actions-cell">
                      {manageable && m.status === "invited" && (
                        <button
                          type="button"
                          className="link"
                          onClick={() =>
                            void action.run(async () => setLink(await api.staffInviteLink(tenantId, m.userId)))
                          }
                        >
                          {t.newLink}
                        </button>
                      )}
                      {manageable && m.userId !== myUserId && (
                        <button type="button" className="link danger" onClick={() => void remove(m.userId, m.email)}>
                          {t.remove}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h2>{t.inviteTitle}</h2>
        <form className="form-row" onSubmit={invite}>
          <input
            type="email"
            placeholder={t.email}
            aria-label={t.email}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            placeholder={t.namePlaceholder}
            aria-label={t.colName}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select aria-label={t.colRole} value={newRole} onChange={(e) => setNewRole(e.target.value as StaffRole)}>
            {assignable.map((r) => (
              <option key={r} value={r}>
                {t.role[r]}
              </option>
            ))}
          </select>
          <button disabled={action.busy}>{t.invite}</button>
        </form>
        {notice && <p className="muted">{notice}</p>}
        {link && <InviteLinkBox link={link} />}
      </section>
    </>
  );
}

export function PlatformSection({ onTenantsChanged }: { onTenantsChanged: () => void }) {
  const { t, number } = useI18n();
  const load = useCallback(() => api.platformTenants(), []);
  const tenants = useLoad(load);
  const action = useAction();
  const dialogs = useDialogs();
  const [link, setLink] = useState<InviteLinkView | null>(null);
  const [form, setForm] = useState({
    name: "",
    country: "VE",
    defaultCurrency: "USD",
    venueName: "",
    timezone: "America/Caracas",
    ownerEmail: "",
  });
  const [resetEmail, setResetEmail] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const loadFees = useCallback(() => api.platformFees(month), [month]);
  const fees = useLoad(loadFees);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function create(e: FormEvent) {
    e.preventDefault();
    void action.run(async () => {
      const result = await api.createTenant({
        ...form,
        country: form.country.toUpperCase(),
        defaultCurrency: form.defaultCurrency.toUpperCase(),
      });
      setLink(result.ownerInvite);
      setForm((f) => ({ ...f, name: "", venueName: "", ownerEmail: "" }));
      tenants.reload();
      onTenantsChanged();
    });
  }

  async function editFee(tenant: PlatformTenantView) {
    const value = await dialogs.prompt({
      title: t.feeEditTitle,
      initial: String(tenant.platformFeeBps / 100),
      required: true,
      maxLength: 6,
      confirmLabel: t.save,
    });
    if (value === null) return;
    const platformFeeBps = Math.round(Number(value.replace(",", ".")) * 100);
    void action.run(async () => {
      await api.updateTenant(tenant.id, { platformFeeBps });
      tenants.reload();
    });
  }

  async function toggleStatus(tenant: PlatformTenantView) {
    const next = tenant.status === "active" ? "suspended" : "active";
    if (next === "suspended") {
      const ok = await dialogs.confirm({
        title: t.suspendTitle(tenant.name),
        body: t.suspendBody,
        confirmLabel: t.suspend,
        danger: true,
      });
      if (!ok) return;
    }
    void action.run(async () => {
      await api.updateTenant(tenant.id, { status: next });
      tenants.reload();
    });
  }

  return (
    <>
      <h1>{t.platformTitle}</h1>
      <section>
        <ErrorText error={tenants.error ?? action.error} />
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.colRestaurant}</th>
                <th>{t.colCountry}</th>
                <th>{t.colCurrency}</th>
                <th>{t.colOwners}</th>
                <th>{t.colFeePercent}</th>
                <th>{t.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              {(tenants.data ?? []).map((tenant) => (
                <tr key={tenant.id}>
                  <td>{tenant.name}</td>
                  <td>{tenant.country}</td>
                  <td>{tenant.defaultCurrency}</td>
                  <td>{tenant.ownerEmails.join(", ") || "—"}</td>
                  <td>
                    <button type="button" className="link" onClick={() => void editFee(tenant)}>
                      {number(tenant.platformFeeBps / 100)}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={tenant.status === "active" ? "link" : "link danger"}
                      onClick={() => void toggleStatus(tenant)}
                    >
                      {tenant.status === "active" ? t.tenantWorking : t.tenantSuspended}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>{t.monthlyFees}</h2>
        <label className="inline-field">
          {t.month}
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value || currentMonth())} />
        </label>
        <ErrorText error={fees.error} />
        <FeeTable rows={fees.data?.rows ?? []} showTenant />
      </section>

      <section>
        <h2>{t.onboardTitle}</h2>
        <form className="form-grid" onSubmit={create}>
          <input placeholder={t.phName} aria-label={t.phName} required value={form.name} onChange={set("name")} />
          <input
            placeholder={t.phVenue}
            aria-label={t.phVenue}
            required
            value={form.venueName}
            onChange={set("venueName")}
          />
          <input
            placeholder={t.phCountry}
            aria-label={t.phCountry}
            required
            maxLength={2}
            value={form.country}
            onChange={set("country")}
          />
          <input
            placeholder={t.phCurrency}
            aria-label={t.phCurrency}
            required
            maxLength={3}
            value={form.defaultCurrency}
            onChange={set("defaultCurrency")}
          />
          <input
            placeholder={t.phTimezone}
            aria-label={t.phTimezone}
            required
            value={form.timezone}
            onChange={set("timezone")}
          />
          <input
            type="email"
            placeholder={t.phOwner}
            aria-label={t.phOwner}
            required
            value={form.ownerEmail}
            onChange={set("ownerEmail")}
          />
          <button disabled={action.busy}>{t.create}</button>
        </form>
      </section>

      <section>
        <h2>{t.passwordResetTitle}</h2>
        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => setLink(await api.passwordLink(resetEmail)));
          }}
        >
          <input
            type="email"
            placeholder={t.email}
            aria-label={t.email}
            required
            value={resetEmail}
            onChange={(e) => setResetEmail(e.target.value)}
          />
          <button className="ghost" disabled={action.busy}>
            {t.passwordLink}
          </button>
        </form>
        {link && <InviteLinkBox link={link} />}
      </section>
    </>
  );
}
