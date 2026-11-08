import type { MeView, SessionView, TenantSettingsView } from "@tabtap/shared";
import { useCallback, useEffect, useState } from "react";
import { api, hasSession, onSessionExpired, setSession } from "./api";
import { InvitePage, LoginPage } from "./AuthPages";
import { PaymentsSection, RatesSection, SettingsSection, TablesSection } from "./RestaurantSections";
import { PlatformSection, StaffSection } from "./TeamSections";
import { ErrorText, messageOf, ROLE_LABEL } from "./ui";

// Functional admin panel for Phase 2; visual design and translations come in Phase 4.

const TENANT_KEY = "tabtap.admin.tenant";
type Tab = "tables" | "payments" | "rates" | "settings" | "staff" | "platform";

function storedTenant(): string | null {
  try {
    return localStorage.getItem(TENANT_KEY);
  } catch {
    return null;
  }
}

export default function App() {
  const inviteToken = window.location.pathname.match(/^\/invite\/([A-Za-z0-9_-]+)$/)?.[1];
  const [me, setMe] = useState<MeView | null>(null);
  const [checking, setChecking] = useState(hasSession());
  const [error, setError] = useState<string | null>(null);

  const signedIn = useCallback((session: SessionView) => {
    setSession(session);
    setMe(session.me);
  }, []);

  useEffect(() => {
    onSessionExpired(() => setMe(null));
    if (!hasSession() || inviteToken) return;
    api
      .me()
      .then(setMe)
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(() => setChecking(false));
  }, [inviteToken]);

  if (inviteToken && !me) return <InvitePage token={inviteToken} onSignedIn={signedIn} />;
  if (checking && !me && !error) return <main className="screen">Загружаем…</main>;
  if (!me) return <LoginPage onSignedIn={signedIn} />;
  return (
    <Dashboard
      me={me}
      onSignOut={() => {
        void api.logout().catch(() => undefined);
        setSession(null);
        setMe(null);
      }}
    />
  );
}

function Dashboard({ me, onSignOut }: { me: MeView; onSignOut: () => void }) {
  // Platform admins can open any restaurant; everyone else picks among their own.
  const [tenants, setTenants] = useState(me.memberships.map((m) => ({ id: m.tenantId, name: m.tenantName })));
  const reloadTenants = useCallback(() => {
    if (!me.isPlatformAdmin) return;
    api
      .platformTenants()
      .then((list) => setTenants(list.map((t) => ({ id: t.id, name: t.name }))))
      .catch(() => undefined);
  }, [me.isPlatformAdmin]);
  useEffect(reloadTenants, [reloadTenants]);

  const [chosenTenantId, setTenantId] = useState<string | null>(() => {
    const saved = storedTenant();
    return saved && (me.isPlatformAdmin || me.memberships.some((m) => m.tenantId === saved))
      ? saved
      : (me.memberships[0]?.tenantId ?? null);
  });
  const [settings, setSettings] = useState<TenantSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(me.memberships.length === 0 && me.isPlatformAdmin ? "platform" : "tables");

  // A platform admin without memberships starts with no restaurant: show the first one.
  const tenantId = chosenTenantId ?? tenants[0]?.id ?? null;

  useEffect(() => {
    if (!tenantId) return;
    try {
      localStorage.setItem(TENANT_KEY, tenantId);
    } catch {
      // not remembered
    }
    let cancelled = false;
    api
      .settings(tenantId)
      .then((s) => !cancelled && (setSettings(s), setError(null)))
      .catch((e: unknown) => !cancelled && setError(messageOf(e)));
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const role = settings?.role;
  const tabs: [Tab, string][] = [
    ["tables", "Столы"],
    ["payments", "Платежи"],
    ["rates", "Курс"],
    ["settings", "Настройки"],
  ];
  if (role === "owner" || role === "manager") tabs.push(["staff", "Сотрудники"]);
  if (me.isPlatformAdmin) tabs.push(["platform", "Платформа"]);

  return (
    <main className="screen">
      <header className="topbar">
        <h1>TabTap</h1>
        {tenants.length > 0 && (
          <select value={tenantId ?? ""} onChange={(e) => setTenantId(e.target.value)}>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <span className="muted">
          {me.email}
          {role && ` · ${ROLE_LABEL[role]}`}
          {me.isPlatformAdmin && " · платформа"}
        </span>
        <button type="button" className="link" onClick={onSignOut}>
          Выйти
        </button>
      </header>

      <nav className="mode-tabs">
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? "tab tab-active" : "tab"} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      <ErrorText error={error} />
      {!tenantId && tab !== "platform" && <p>Вы пока не привязаны ни к одному ресторану.</p>}
      {tenantId && settings && role && (
        <>
          {tab === "tables" && <TablesSection tenantId={tenantId} role={role} />}
          {tab === "payments" && <PaymentsSection tenantId={tenantId} />}
          {tab === "rates" && <RatesSection tenantId={tenantId} settings={settings} />}
          {tab === "settings" && <SettingsSection key={settings.id} settings={settings} onSaved={setSettings} />}
          {tab === "staff" && <StaffSection tenantId={tenantId} role={role} myUserId={me.userId} />}
        </>
      )}
      {tab === "platform" && me.isPlatformAdmin && <PlatformSection onTenantsChanged={reloadTenants} />}
    </main>
  );
}
