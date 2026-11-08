import { splitEvenly, type TableBillView } from "@tabtap/shared";
import { useState, type ReactNode } from "react";
import { useI18n } from "./i18n";
import { BackButton, IconCheck, Stepper, TopBar } from "./ui";

function ContinueBar({ amount, disabled, onClick }: { amount: string; disabled: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <div className="paybar">
      <button type="button" className="primary" disabled={disabled} onClick={onClick}>
        <span>{t.continue}</span>
        <span className="amount">{amount}</span>
      </button>
    </div>
  );
}

export function ItemsStep(props: {
  view: TableBillView;
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  amountMinor: number;
  onBack: () => void;
  onContinue: () => void;
  banner: ReactNode;
}) {
  const { t, money } = useI18n();
  const { bill } = props.view;

  function toggle(id: string) {
    const next = new Set(props.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    props.onChange(next);
  }

  return (
    <div className="app with-paybar">
      <TopBar />
      <main>
        <BackButton onClick={props.onBack} />
        <h1>{t.chooseItems}</h1>
        <p className="muted">{t.chooseItemsHint}</p>
        {props.banner}
        <section className="pick-list">
          {bill.items.map((item) => {
            const available = item.state === "available";
            const checked = available && props.selected.has(item.id);
            return (
              <label key={item.id} className={`pick ${checked ? "pick-on" : ""} ${available ? "" : "pick-taken"}`}>
                <input type="checkbox" disabled={!available} checked={checked} onChange={() => toggle(item.id)} />
                <span className="box" aria-hidden="true">
                  {checked && <IconCheck size={18} />}
                </span>
                <span className="line-name">
                  <span className="qty">{item.quantity}×</span> {item.name}
                  {!available && <span className={`chip chip-${item.state}`}>{t.claim[item.state as "paid"]}</span>}
                </span>
                <span className="amount">{money(item.lineTotalMinor, bill.currency)}</span>
              </label>
            );
          })}
        </section>
      </main>
      <ContinueBar
        amount={money(props.amountMinor, bill.currency)}
        disabled={props.amountMinor <= 0}
        onClick={props.onContinue}
      />
    </div>
  );
}

export function SharesStep(props: {
  view: TableBillView;
  busy: boolean;
  shareCount: number;
  onShareCount: (n: number) => void;
  amountMinor: number;
  onSplit: (parts: number) => void;
  onRemove: () => void;
  onBack: () => void;
  onContinue: () => void;
  banner: ReactNode;
}) {
  const { t, money } = useI18n();
  const { view } = props;
  const split = view.equalSplit;
  const currency = view.bill.currency;
  const [editing, setEditing] = useState(false);

  const configure = !split || editing;
  const available = split?.shares.filter((s) => s.state === "available").length ?? 0;

  return (
    <div className="app with-paybar">
      <TopBar />
      <main>
        <BackButton onClick={props.onBack} />
        <h1>{t.splitTitle}</h1>
        <p className="muted">{t.splitHint}</p>
        {props.banner}

        {configure ? (
          <SplitSetup
            key={split?.shareCount ?? 0}
            initialParts={split?.shareCount ?? 2}
            remainingMinor={view.bill.remainingMinor}
            currency={currency}
            busy={props.busy}
            onApply={(parts) => {
              props.onSplit(parts);
              setEditing(false);
            }}
            onRemove={
              split
                ? () => {
                    props.onRemove();
                    setEditing(false);
                  }
                : undefined
            }
          />
        ) : (
          <>
            <section>
              <div className="section-head">
                <h2>{t.splitBetween(split.shareCount)}</h2>
                {!split.frozen && (
                  <button type="button" className="link" onClick={() => setEditing(true)}>
                    {t.splitChange}
                  </button>
                )}
              </div>
              <ul className="shares">
                {split.shares.map((share) => (
                  <li key={share.index} className={share.state === "available" ? "share" : "share share-taken"}>
                    <span>{t.shareN(share.index + 1)}</span>
                    <span>
                      {share.state !== "available" && (
                        <span className={`chip chip-${share.state}`}>{t.claim[share.state]}</span>
                      )}
                      <span className="amount">{money(share.amountMinor, currency)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            {available > 0 && (
              <section className="stepper-row">
                <h2>{t.iPayShares}</h2>
                <Stepper
                  label={t.iPayShares}
                  value={Math.min(props.shareCount, available)}
                  min={1}
                  max={available}
                  onChange={props.onShareCount}
                />
              </section>
            )}
          </>
        )}
      </main>
      {!configure && (
        <ContinueBar
          amount={money(props.amountMinor, currency)}
          disabled={props.amountMinor <= 0}
          onClick={props.onContinue}
        />
      )}
    </div>
  );
}

function SplitSetup(props: {
  initialParts: number;
  remainingMinor: number;
  currency: string;
  busy: boolean;
  onApply: (parts: number) => void;
  onRemove?: () => void;
}) {
  const { t, money } = useI18n();
  const [parts, setParts] = useState(props.initialParts);
  return (
    <section className="split-setup">
      <div className="stepper-row">
        <h2>{t.splitPeople}</h2>
        <Stepper label={t.splitPeople} value={parts} min={2} max={30} onChange={setParts} />
      </div>
      <p className="split-preview amount">
        {t.perPerson(money(splitEvenly(props.remainingMinor, parts)[0], props.currency))}
      </p>
      <button type="button" className="primary" disabled={props.busy} onClick={() => props.onApply(parts)}>
        {t.splitAction(parts)}
      </button>
      {props.onRemove && (
        <button type="button" className="secondary" disabled={props.busy} onClick={props.onRemove}>
          {t.splitRemove}
        </button>
      )}
    </section>
  );
}
