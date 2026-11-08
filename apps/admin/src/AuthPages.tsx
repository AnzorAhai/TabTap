import type { InviteInfoView, SessionView } from "@tabtap/shared";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "./api";
import { errorText, useI18n } from "./i18n";
import { ErrorText, LanguagePicker, Logo, useAction } from "./ui";

function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-top">
        <span className="auth-brand">
          <Logo size={34} />
          <strong>TabTap</strong>
        </span>
        <LanguagePicker />
      </div>
      <h1>{title}</h1>
      <section>{children}</section>
    </main>
  );
}

export function LoginPage({ onSignedIn }: { onSignedIn: (session: SessionView) => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => onSignedIn(await api.login(email, password)));
  }

  return (
    <AuthLayout title={t.loginTitle}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          {t.email}
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          {t.password}
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <ErrorText error={error} />
        <button disabled={busy}>{busy ? t.signingIn : t.signIn}</button>
      </form>
      <p className="muted small auth-note">{t.noPassword}</p>
    </AuthLayout>
  );
}

/** /invite/:token — choose a password from a one-time link. */
export function InvitePage({ token, onSignedIn }: { token: string; onSignedIn: (session: SessionView) => void }) {
  const { t } = useI18n();
  const [info, setInfo] = useState<InviteInfoView | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    api
      .invite(token)
      .then((i) => {
        setInfo(i);
        setName(i.name);
      })
      .catch((e: unknown) => setLoadError(e));
  }, [token]);

  function submit(e: FormEvent) {
    e.preventDefault();
    setMismatch(password !== repeat);
    if (password !== repeat) return;
    void run(async () => {
      const session = await api.acceptInvite(token, password, name);
      window.history.replaceState(null, "", "/");
      onSignedIn(session);
    });
  }

  if (loadError) {
    return (
      <AuthLayout title={t.linkBroken}>
        <p>{errorText(loadError, t)}</p>
        <a href="/">{t.toLogin}</a>
      </AuthLayout>
    );
  }
  if (!info) return <main className="centered">{t.checkingLink}</main>;

  return (
    <AuthLayout title={info.purpose === "invite" ? t.welcome : t.newPassword}>
      <p>
        {t.account}: <strong>{info.email}</strong>
      </p>
      <form className="form" onSubmit={submit}>
        {info.purpose === "invite" && (
          <label className="field">
            {t.yourName}
            <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </label>
        )}
        <label className="field">
          {t.passwordRule}
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="field">
          {t.repeatPassword}
          <input
            type="password"
            autoComplete="new-password"
            required
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </label>
        {mismatch ? <div className="error">{t.passwordsDiffer}</div> : <ErrorText error={error} />}
        <button disabled={busy}>{busy ? t.saving : t.saveAndEnter}</button>
      </form>
    </AuthLayout>
  );
}
