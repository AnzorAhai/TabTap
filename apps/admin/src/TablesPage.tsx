import { LANGUAGE_NAMES, LANGUAGES, type AdminTableView, type Language, type StaffRole } from "@tabtap/shared";
import QRCode from "qrcode";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { useI18n } from "./i18n";
import { ErrorText, Logo, useAction, useDialogs, useLoad } from "./ui";

/** What the printed card tells guests, in the language chosen for printing. */
const CARD_TEXT: Record<Language, { cta: string; sub: string }> = {
  es: { cta: "Escanea y paga tu cuenta", sub: "Sin esperar. Divide la cuenta con tu mesa." },
  en: { cta: "Scan to pay your bill", sub: "No waiting. Split it with your table." },
  ru: { cta: "Отсканируйте и оплатите счёт", sub: "Без ожидания. Можно разделить на всех." },
};

function QrImage({ value, alt, pixels, shown }: { value: string; alt: string; pixels: number; shown?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: pixels, errorCorrectionLevel: "M" })
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, pixels]);
  if (!src) return <div className="qr-placeholder" />;
  return <img src={src} alt={alt} width={shown} height={shown} />;
}

export function TablesPage({
  tenantId,
  role,
  restaurantName,
}: {
  tenantId: string;
  role: StaffRole;
  restaurantName: string;
}) {
  const { t } = useI18n();
  const managing = role === "owner" || role === "manager";
  const loadTables = useCallback(() => api.tables(tenantId), [tenantId]);
  const loadVenues = useCallback(() => api.venues(tenantId), [tenantId]);
  const tables = useLoad(loadTables);
  const venues = useLoad(loadVenues);
  const action = useAction();
  const dialogs = useDialogs();
  const [label, setLabel] = useState("");
  const [posRef, setPosRef] = useState("");
  const [printing, setPrinting] = useState(false);

  function create(e: FormEvent) {
    e.preventDefault();
    const venueId = venues.data?.[0]?.id;
    if (!venueId) return;
    void action.run(async () => {
      await api.createTable(tenantId, { venueId, label, posTableRef: posRef });
      setLabel("");
      setPosRef("");
      tables.reload();
    });
  }

  const change = (update: () => Promise<unknown>) =>
    void action.run(async () => {
      await update();
      tables.reload();
    });

  async function rename(table: AdminTableView) {
    const next = await dialogs.prompt({
      title: t.renameTitle,
      initial: table.label,
      required: true,
      maxLength: 50,
      confirmLabel: t.save,
    });
    if (next && next !== table.label) change(() => api.updateTable(tenantId, table.id, { label: next }));
  }

  async function rotate(table: AdminTableView) {
    const ok = await dialogs.confirm({ title: t.newQrTitle, body: t.newQrBody, confirmLabel: t.newQr, danger: true });
    if (ok) change(() => api.rotateQr(tenantId, table.id));
  }

  if (printing) {
    return (
      <PrintCards
        tables={(tables.data ?? []).filter((x) => x.isActive)}
        restaurantName={restaurantName}
        onBack={() => setPrinting(false)}
      />
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>{t.tablesTitle}</h1>
        <button type="button" disabled={!tables.data?.length} onClick={() => setPrinting(true)}>
          {t.printCards}
        </button>
      </div>
      <ErrorText error={tables.error ?? action.error} />
      <div className="tables-grid">
        {(tables.data ?? []).map((table) => (
          <div key={table.id} className={table.isActive ? "table-card" : "table-card inactive"}>
            <QrImage value={table.guestUrl} alt={t.qrAlt(table.label)} pixels={280} shown={140} />
            <div className="table-label">{table.label}</div>
            <span className={table.isActive ? "state state-ok" : "state"}>
              {table.isActive ? t.tableActive : t.tableDisabled}
            </span>
            <a href={table.guestUrl} target="_blank" rel="noreferrer">
              {t.openAsGuest}
            </a>
            <span className="muted small">{t.posRef(table.posTableRef)}</span>
            {managing && (
              <div className="card-actions">
                <button type="button" className="link" disabled={action.busy} onClick={() => void rename(table)}>
                  {t.rename}
                </button>
                <button
                  type="button"
                  className="link"
                  disabled={action.busy}
                  onClick={() => change(() => api.updateTable(tenantId, table.id, { isActive: !table.isActive }))}
                >
                  {table.isActive ? t.disable : t.enable}
                </button>
                <button type="button" className="link" disabled={action.busy} onClick={() => void rotate(table)}>
                  {t.newQr}
                </button>
              </div>
            )}
          </div>
        ))}
        {tables.data?.length === 0 && <p>{t.noTables}</p>}
      </div>
      {managing && (
        <section>
          <form className="form-row" onSubmit={create}>
            <input
              placeholder={t.tableNamePlaceholder}
              aria-label={t.tableNamePlaceholder}
              required
              maxLength={50}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <input
              placeholder={t.posIdPlaceholder}
              aria-label={t.posIdPlaceholder}
              required
              maxLength={100}
              value={posRef}
              onChange={(e) => setPosRef(e.target.value)}
            />
            <button disabled={action.busy || !venues.data?.length}>{t.addTable}</button>
          </form>
        </section>
      )}
    </>
  );
}

function PrintCards({
  tables,
  restaurantName,
  onBack,
}: {
  tables: AdminTableView[];
  restaurantName: string;
  onBack: () => void;
}) {
  const { t, language } = useI18n();
  const [cardLanguage, setCardLanguage] = useState<Language>(language);
  const text = CARD_TEXT[cardLanguage];

  return (
    <>
      <div className="no-print">
        <div className="page-head">
          <h1>{t.printTitle}</h1>
          <div className="row-actions">
            <button type="button" className="ghost" onClick={onBack}>
              {t.back}
            </button>
            <button type="button" onClick={() => window.print()}>
              {t.printNow}
            </button>
          </div>
        </div>
        <p className="muted">{t.printHint}</p>
        <label className="inline-field">
          {t.printLanguage}
          <select value={cardLanguage} onChange={(e) => setCardLanguage(e.target.value as Language)}>
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="print-sheet">
        {tables.map((table) => (
          <article key={table.id} className="print-card">
            <header>
              <Logo size={40} />
              <span>{restaurantName}</span>
            </header>
            <div className="print-table">{table.label}</div>
            <QrImage value={table.guestUrl} alt={t.qrAlt(table.label)} pixels={720} />
            <p className="print-cta">{text.cta}</p>
            <p className="print-sub">{text.sub}</p>
            <footer>TabTap</footer>
          </article>
        ))}
      </div>
    </>
  );
}
