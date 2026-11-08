import type { InviteLinkView, StaffRole } from "@tabtap/shared";
import { useCallback, useState, type FormEvent } from "react";
import { api } from "./api";
import { ErrorText, formatTime, InviteLinkBox, ROLE_LABEL, useAction, useLoad } from "./ui";

const STATUS_LABEL = { invited: "Приглашён", active: "Активен", disabled: "Отключён" } as const;

export function StaffSection({ tenantId, role, myUserId }: { tenantId: string; role: StaffRole; myUserId: string }) {
  const load = useCallback(() => api.staff(tenantId), [tenantId]);
  const staff = useLoad(load);
  const action = useAction();
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
      setNotice(
        result.inviteLink ? null : `${result.member.email} уже есть в TabTap — он(а) просто входит со своим паролем.`,
      );
      setEmail("");
      setName("");
      staff.reload();
    });
  }

  return (
    <section>
      <h2>Сотрудники</h2>
      <ErrorText error={staff.error ?? action.error} />
      <div className="table-scroll">
        <table className="payments-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Имя</th>
              <th>Роль</th>
              <th>Статус</th>
              <th>Последний вход</th>
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
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      ROLE_LABEL[m.role]
                    )}
                  </td>
                  <td>{STATUS_LABEL[m.status]}</td>
                  <td>{m.lastLoginAt ? formatTime(m.lastLoginAt) : "—"}</td>
                  <td className="actions-cell">
                    {manageable && m.status === "invited" && (
                      <button
                        type="button"
                        className="link"
                        onClick={() =>
                          void action.run(async () => setLink(await api.staffInviteLink(tenantId, m.userId)))
                        }
                      >
                        Новая ссылка
                      </button>
                    )}
                    {manageable && m.userId !== myUserId && (
                      <button
                        type="button"
                        className="link danger"
                        onClick={() => {
                          if (!window.confirm(`Убрать ${m.email} из ресторана?`)) return;
                          void action.run(async () => {
                            await api.removeStaff(tenantId, m.userId);
                            staff.reload();
                          });
                        }}
                      >
                        Убрать
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3>Пригласить</h3>
      <form className="form inline" onSubmit={invite}>
        <input type="email" placeholder="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="имя (необязательно)" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value as StaffRole)}>
          {assignable.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <button disabled={action.busy}>Пригласить</button>
      </form>
      {notice && <p className="muted">{notice}</p>}
      {link && <InviteLinkBox link={link} />}
    </section>
  );
}

export function PlatformSection({ onTenantsChanged }: { onTenantsChanged: () => void }) {
  const load = useCallback(() => api.platformTenants(), []);
  const tenants = useLoad(load);
  const action = useAction();
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

  return (
    <section>
      <h2>Платформа TabTap</h2>
      <ErrorText error={tenants.error ?? action.error} />
      <div className="table-scroll">
        <table className="payments-table">
          <thead>
            <tr>
              <th>Ресторан</th>
              <th>Страна</th>
              <th>Валюта</th>
              <th>Владельцы</th>
              <th>Комиссия, %</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {(tenants.data ?? []).map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.country}</td>
                <td>{t.defaultCurrency}</td>
                <td>{t.ownerEmails.join(", ") || "—"}</td>
                <td>
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      const value = window.prompt("Комиссия, % от суммы счёта", String(t.platformFeeBps / 100));
                      if (value === null) return;
                      const bps = Math.round(Number(value.replace(",", ".")) * 100);
                      void action.run(async () => {
                        await api.updateTenant(t.id, { platformFeeBps: bps });
                        tenants.reload();
                      });
                    }}
                  >
                    {(t.platformFeeBps / 100).toLocaleString("ru-RU")}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className={t.status === "active" ? "link" : "link danger"}
                    onClick={() => {
                      const next = t.status === "active" ? "suspended" : "active";
                      if (
                        next === "suspended" &&
                        !window.confirm(`Приостановить «${t.name}»? Гости не смогут открыть его столы.`)
                      )
                        return;
                      void action.run(async () => {
                        await api.updateTenant(t.id, { status: next });
                        tenants.reload();
                      });
                    }}
                  >
                    {t.status === "active" ? "Работает" : "Приостановлен"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Подключить ресторан</h3>
      <form className="form grid" onSubmit={create}>
        <input placeholder="Название" required value={form.name} onChange={set("name")} />
        <input placeholder="Заведение (зал/адрес)" required value={form.venueName} onChange={set("venueName")} />
        <input placeholder="Страна (VE)" required maxLength={2} value={form.country} onChange={set("country")} />
        <input
          placeholder="Валюта кассы (USD)"
          required
          maxLength={3}
          value={form.defaultCurrency}
          onChange={set("defaultCurrency")}
        />
        <input placeholder="Часовой пояс" required value={form.timezone} onChange={set("timezone")} />
        <input
          type="email"
          placeholder="Email владельца"
          required
          value={form.ownerEmail}
          onChange={set("ownerEmail")}
        />
        <button disabled={action.busy}>Создать</button>
      </form>

      <h3>Сброс пароля</h3>
      <form
        className="form inline"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => setLink(await api.passwordLink(resetEmail)));
        }}
      >
        <input
          type="email"
          placeholder="Email"
          required
          value={resetEmail}
          onChange={(e) => setResetEmail(e.target.value)}
        />
        <button disabled={action.busy}>Ссылка для нового пароля</button>
      </form>
      {link && <InviteLinkBox link={link} />}
    </section>
  );
}
