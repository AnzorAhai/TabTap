import type { InviteInfoView, SessionView } from "@tabtap/shared";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { ErrorText, messageOf, useAction } from "./ui";

export function LoginPage({ onSignedIn }: { onSignedIn: (session: SessionView) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => onSignedIn(await api.login(email, password)));
  }

  return (
    <main className="screen narrow">
      <h1>TabTap — вход для ресторана</h1>
      <section>
        <form className="form" onSubmit={submit}>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <ErrorText error={error} />
          <button disabled={busy}>{busy ? "Входим…" : "Войти"}</button>
        </form>
        <p className="muted">
          Нет пароля или забыли его? Попросите владельца ресторана или поддержку TabTap прислать ссылку.
        </p>
      </section>
    </main>
  );
}

/** /invite/:token — choose a password from a one-time link. */
export function InvitePage({ token, onSignedIn }: { token: string; onSignedIn: (session: SessionView) => void }) {
  const [info, setInfo] = useState<InviteInfoView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    api
      .invite(token)
      .then((i) => (setInfo(i), setName(i.name)))
      .catch((e: unknown) => setLoadError(messageOf(e)));
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
      <main className="screen narrow">
        <h1>Ссылка не работает</h1>
        <section>
          <p>{loadError}</p>
          <a href="/">Ко входу</a>
        </section>
      </main>
    );
  }
  if (!info) return <main className="screen narrow">Проверяем ссылку…</main>;

  return (
    <main className="screen narrow">
      <h1>{info.purpose === "invite" ? "Добро пожаловать в TabTap" : "Новый пароль"}</h1>
      <section>
        <p>
          Аккаунт: <strong>{info.email}</strong>
        </p>
        <form className="form" onSubmit={submit}>
          {info.purpose === "invite" && (
            <label>
              Ваше имя
              <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </label>
          )}
          <label>
            Пароль (не короче 10 символов)
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            Повторите пароль
            <input
              type="password"
              autoComplete="new-password"
              required
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </label>
          <ErrorText error={mismatch ? "Пароли не совпадают" : error} />
          <button disabled={busy}>{busy ? "Сохраняем…" : "Сохранить и войти"}</button>
        </form>
      </section>
    </main>
  );
}
