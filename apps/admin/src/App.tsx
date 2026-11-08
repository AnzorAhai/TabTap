import type { MeView, SessionView, TenantSettingsView } from "@tabtap/shared";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, hasSession, onSessionExpired, setSession } from "./api";
import { InvitePage, LoginPage } from "./AuthPages";
import { useI18n } from "./i18n";
import { FeesSection, PaymentMethodsSection } from "./PaymentSettings";
import { PaymentsPage } from "./PaymentsPage";
import { RatesSection, SettingsSection } from "./RestaurantSettings";
import { TablesPage } from "./TablesPage";
import { PlatformSection, StaffSection } from "./TeamSections";
import { TodayPage } from "./TodayPage";
import { ErrorText, LanguagePicker, Logo } from "./ui";

const TENANT_KEY = "tabtap.admin.tenant";
type Page = "today" | "tables" | "payments" | "methods" | "rates" | "fees" | "settings" | "staff" | "platform";

function storedTenant(): string | null {
  try {
    return localStorage.getItem(TENANT_KEY);
  } catch {
    return null;
  }
}

export default function App() {
  const { t } = useI18n();
  const inviteToken = window.location.pathname.match(/^\/invite\/([A-Za-z0-9_-]+)$/)?.[1];
  const [me, setMe] = useState<MeView | null>(null);
  const [checking, setChecking] = useState(hasSession());
  const [error, setError] = useState<unknown>(null);

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
      .catch((e: unknown) => setError(e))
      .finally(() => setChecking(false));
  }, [inviteToken]);

  if (inviteToken && !me) return <InvitePage token={inviteToken} onSignedIn={signedIn} />;
  if (checking && !me && !error) return <main className="centered">{t.loading}</main>;
  // A session we couldn't check (server unreachable) isn't a signed-out session.
  if (!me && error instanceof ApiError && error.status === 0) {
    return (
      <main className="centered">
        <ErrorText error={error} />
      </main>
    );
  }
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
  const { t } = useI18n();
  // Platform admins can open any restaurant; everyone else picks among their own.
  const [tenants, setTenants] = useState(me.memberships.map((m) => ({ id: m.tenantId, name: m.tenantName })));
  const reloadTenants = useCallback(() => {
    if (!me.isPlatformAdmin) return;
    api
      .platformTenants()
      .then((list) => setTenants(list.map((x) => ({ id: x.id, name: x.name }))))
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
  const [error, setError] = useState<unknown>(null);
  const [page, setPage] = useState<Page>(me.memberships.length === 0 && me.isPlatformAdmin ? "platform" : "today");

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
      .then((s) => {
        if (!cancelled) {
          setSettings(s);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const role = settings?.role;
  const managing = role === "owner" || role === "manager";
  const pages: Page[] = [
    "today",
    "tables",
    "payments",
    "methods",
    "rates",
    ...(managing ? (["fees", "staff"] as Page[]) : []),
    "settings",
    ...(me.isPlatformAdmin ? (["platform"] as Page[]) : []),
  ];

  return (
    <div className="shell">
      <aside className="sidebar no-print">
        <div className="sidebar-brand">
          <Logo size={30} />
          <strong>TabTap</strong>
        </div>
        {tenants.length > 1 ? (
          <select
            aria-label={t.restaurantLabel}
            value={tenantId ?? ""}
            onChange={(e) => {
              setSettings(null);
              setTenantId(e.target.value);
            }}
          >
            {tenants.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="sidebar-tenant">{tenants[0]?.name}</div>
        )}
        <nav>
          {pages.map((key) => (
            <button
              key={key}
              type="button"
              className={page === key ? "nav-item nav-item-on" : "nav-item"}
              aria-current={page === key ? "page" : undefined}
              onClick={() => setPage(key)}
            >
              {t.nav[key]}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <LanguagePicker />
          <div className="muted small user-line">
            {me.email}
            {role && ` · ${t.role[role]}`}
            {me.isPlatformAdmin && ` · ${t.platformBadge}`}
          </div>
          <button type="button" className="link" onClick={onSignOut}>
            {t.signOut}
          </button>
        </div>
      </aside>

      <main className="content">
        <ErrorText error={error} />
        {!tenantId && page !== "platform" && <p>{t.noRestaurant}</p>}
        {tenantId && settings && role && (
          <>
            {page === "today" && <TodayPage tenantId={tenantId} role={role} />}
            {page === "tables" && <TablesPage tenantId={tenantId} role={role} restaurantName={settings.name} />}
            {page === "payments" && <PaymentsPage tenantId={tenantId} role={role} />}
            {page === "methods" && <PaymentMethodsSection tenantId={tenantId} role={role} />}
            {page === "rates" && <RatesSection tenantId={tenantId} settings={settings} />}
            {page === "fees" && <FeesSection tenantId={tenantId} />}
            {page === "settings" && <SettingsSection key={settings.id} settings={settings} onSaved={setSettings} />}
            {page === "staff" && <StaffSection tenantId={tenantId} role={role} myUserId={me.userId} />}
          </>
        )}
        {page === "platform" && me.isPlatformAdmin && <PlatformSection onTenantsChanged={reloadTenants} />}
      </main>
    </div>
  );
}
