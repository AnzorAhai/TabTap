import type { StaffRole, TenantSettingsView } from "@tabtap/shared";
import { useCallback, useState, type FormEvent } from "react";
import { api } from "./api";
import { useI18n } from "./i18n";
import { ErrorText, useAction, useLoad } from "./ui";

const canManage = (role: StaffRole) => role === "owner" || role === "manager";

export function RatesSection({ tenantId, settings }: { tenantId: string; settings: TenantSettingsView }) {
  const { t, dateTime, number } = useI18n();
  const load = useCallback(() => api.rates(tenantId), [tenantId]);
  const rates = useLoad(load);
  const action = useAction();
  const [quote, setQuote] = useState("VES");
  const [rate, setRate] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    void action.run(async () => {
      await api.setRate(tenantId, { baseCurrency: settings.defaultCurrency, quoteCurrency: quote, rate: rate.trim() });
      setRate("");
      rates.reload();
    });
  }

  const sourceName = (source: string) =>
    source === "bcv" ? t.sourceBcv : source === "manual" ? t.sourceManual : source;

  return (
    <>
      <h1>{t.ratesTitle}</h1>
      <section>
        <ErrorText error={rates.error ?? action.error} />
        {rates.data?.length === 0 && <p>{t.noRate}</p>}
        {(rates.data ?? []).map((r) => (
          <div key={`${r.baseCurrency}-${r.quoteCurrency}`} className="rate">
            <div className="rate-value">
              1 {r.baseCurrency} = <strong>{number(r.rate, 4)}</strong> {r.quoteCurrency}
            </div>
            <div className="muted small">
              {t.rateSince(dateTime(r.effectiveAt))} · {sourceName(r.source)}
            </div>
          </div>
        ))}
        <p className="muted">{settings.rateSource === "bcv" ? t.rateAutoHint : t.rateManualHint}</p>
        {canManage(settings.role) && (
          <>
            <button
              type="button"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await api.refreshBcv(tenantId);
                  rates.reload();
                })
              }
            >
              {t.takeBcv}
            </button>
            <form className="form-row" onSubmit={submit}>
              <span>1 {settings.defaultCurrency} =</span>
              <input
                inputMode="decimal"
                placeholder={t.rateExample}
                aria-label={t.setManually}
                required
                pattern="\d{1,12}(\.\d{1,8})?"
                value={rate}
                onChange={(e) => setRate(e.target.value.replace(",", "."))}
              />
              <input
                className="short"
                aria-label={t.colCurrency}
                value={quote}
                maxLength={3}
                required
                onChange={(e) => setQuote(e.target.value.toUpperCase())}
              />
              <button className="ghost" disabled={action.busy}>
                {t.setManually}
              </button>
            </form>
          </>
        )}
      </section>
    </>
  );
}

export function SettingsSection({
  settings,
  onSaved,
}: {
  settings: TenantSettingsView;
  onSaved: (s: TenantSettingsView) => void;
}) {
  const { t, number } = useI18n();
  const action = useAction();
  const [name, setName] = useState(settings.name);
  const [rateSource, setRateSource] = useState(settings.rateSource);
  const [tips, setTips] = useState(settings.tipPercentOptions.join(", "));
  const [justSaved, setJustSaved] = useState(false);
  const editable = canManage(settings.role);

  function submit(e: FormEvent) {
    e.preventDefault();
    setJustSaved(false);
    void action.run(async () => {
      const saved = await api.updateSettings(settings.id, {
        name: settings.role === "owner" ? name : undefined,
        rateSource,
        tipPercentOptions: tips
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number),
      });
      onSaved(saved);
      setJustSaved(true);
    });
  }

  return (
    <>
      <h1>{t.settingsTitle}</h1>
      <section>
        <form className="form" onSubmit={submit}>
          <label className="field">
            {t.restaurantName}
            <input value={name} disabled={settings.role !== "owner"} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            {t.billCurrency}
            <input value={settings.defaultCurrency} disabled />
          </label>
          <label className="field">
            {t.rateSource}
            <select
              value={rateSource}
              disabled={!editable}
              onChange={(e) => setRateSource(e.target.value as "manual" | "bcv")}
            >
              <option value="bcv">{t.rateSourceBcv}</option>
              <option value="manual">{t.rateSourceManual}</option>
            </select>
          </label>
          <label className="field">
            {t.tipOptions}
            <input value={tips} disabled={!editable} onChange={(e) => setTips(e.target.value)} />
          </label>
          <p className="muted">{t.platformFee(number(settings.platformFeeBps / 100))}</p>
          <ErrorText error={action.error} />
          {editable && (
            <div className="form-actions">
              <button disabled={action.busy}>{t.save}</button>
              {justSaved && <span className="state state-ok">{t.saved}</span>}
            </div>
          )}
        </form>
      </section>
    </>
  );
}
