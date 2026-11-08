import {
  basisPointsOf,
  convertMinor,
  percentOf,
  type PaymentMethod,
  type PaymentMethodOption,
  type PaymentMode,
  type PaymentView,
  type TableBillView,
} from "@tabtap/shared";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { BillCard } from "./BillCard";
import { Checkout } from "./Checkout";
import { errorText, useI18n } from "./i18n";
import { ItemsStep, SharesStep } from "./ChooseSteps";
import { PaymentDone, ReceiptsList } from "./Receipt";
import { PendingPayment } from "./PendingPayment";
import { loadActivePayment, loadReceipts, rememberActivePayment, saveReceipt } from "./receipts";
import { IconBill, IconCheck, IconChevron, IconDish, IconPeople, TopBar } from "./ui";

type Step = "bill" | "items" | "shares" | "checkout";

/** Random key for one "Pay" tap; crypto.randomUUID needs HTTPS, getRandomValues doesn't. */
function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What a method would charge for an amount in the bill currency. Preview: the server computes the real one the same way. */
export function chargeFor(option: PaymentMethodOption, amountMinor: number, billCurrency: string) {
  const convertedMinor = option.rate
    ? convertMinor(amountMinor, billCurrency, option.currency, option.rate)
    : amountMinor;
  const surchargeMinor = basisPointsOf(convertedMinor, option.surchargeBps);
  return { surchargeMinor, chargeMinor: convertedMinor + surchargeMinor };
}

export function BillFlow({
  view,
  setView,
  loadError,
  refresh,
}: {
  view: TableBillView;
  setView: (view: TableBillView) => void;
  loadError: unknown;
  refresh: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { bill } = view;
  const billId = bill.id;

  const [step, setStep] = useState<Step>("bill");
  const [mode, setMode] = useState<PaymentMode>("full");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [shareCount, setShareCount] = useState(1);
  const [tipPercent, setTipPercent] = useState(0);
  const [chosenMethod, setChosenMethod] = useState<PaymentMethod | null>(null);
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const [retryKey, setRetryKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [receipts, setReceipts] = useState(() => loadReceipts(billId));

  // Steps are browser history entries, so the phone's back button walks back through them.
  function go(next: Step) {
    window.history.pushState({ step: next }, "");
    setStep(next);
    setError(null);
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setStep((e.state as { step?: Step } | null)?.step ?? "bill");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const onPaymentUpdate = useCallback(
    async (p: PaymentView) => {
      setPayment(p);
      rememberActivePayment(billId, p.status === "pending" ? p.id : null);
      if (p.status === "succeeded") {
        try {
          setReceipts(saveReceipt(billId, await api.receipt(p.id)));
        } catch (e) {
          setError(e);
        }
      }
      if (p.status !== "pending") {
        setStep("bill");
        void refresh();
      }
    },
    [billId, refresh],
  );

  // Back from the banking app with a reloaded tab: pick the payment up where it was.
  useEffect(() => {
    const paymentId = loadActivePayment(billId);
    if (!paymentId) return;
    let cancelled = false;
    api
      .payment(paymentId)
      .then((p) => (cancelled ? undefined : onPaymentUpdate(p)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [billId, onPaymentUpdate]);

  // Fallback for when the push update is missed: poll the payment while it is pending.
  const pendingPaymentId = payment?.status === "pending" ? payment.id : null;
  useEffect(() => {
    if (!pendingPaymentId) return;
    const timer = window.setInterval(() => {
      api
        .payment(pendingPaymentId)
        .then((p) => (p.status !== "pending" ? onPaymentUpdate(p) : undefined))
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [pendingPaymentId, onPaymentUpdate]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e);
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  const availableShares = view.equalSplit?.shares.filter((s) => s.state === "available") ?? [];
  const amountMinor =
    mode === "full"
      ? bill.remainingMinor
      : mode === "items"
        ? bill.items
            .filter((i) => selectedItems.has(i.id) && i.state === "available")
            .reduce((sum, i) => sum + i.lineTotalMinor, 0)
        : Math.min(
            availableShares.slice(0, shareCount).reduce((sum, s) => sum + s.amountMinor, 0),
            bill.remainingMinor,
          );
  const tipMinor = percentOf(amountMinor, tipPercent);
  const method = view.paymentMethods.find((m) => m.method === chosenMethod) ?? view.paymentMethods[0] ?? null;

  async function pay() {
    if (!method) return;
    const key = retryKey ?? newIdempotencyKey();
    setRetryKey(key);
    setBusy(true);
    setError(null);
    try {
      const created = await api.createPayment(
        billId,
        {
          mode,
          itemIds: mode === "items" ? [...selectedItems] : undefined,
          shareCount: mode === "shares" ? shareCount : undefined,
          tipPercent,
          method: method.method,
        },
        key,
      );
      setRetryKey(null);
      setSelectedItems(new Set());
      setShareCount(1);
      window.scrollTo(0, 0);
      await onPaymentUpdate(created);
    } catch (e) {
      // Network failure: the payment may exist already, so a retry must reuse the key.
      if (!(e instanceof ApiError && e.status === 0)) setRetryKey(null);
      setError(e);
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  function startMode(next: PaymentMode) {
    setMode(next);
    go(next === "full" ? "checkout" : next === "items" ? "items" : "shares");
  }

  const errorBanner = (error !== null || loadError !== null) && (
    <div className="banner banner-bad" role="alert">
      {error !== null ? errorText(error, t) : t.connectionLost}
    </div>
  );

  // A payment in progress or just finished takes over the screen.
  if (payment?.status === "pending") {
    return (
      <div className="app">
        <TopBar />
        <main>
          {errorBanner}
          <PendingPayment payment={payment} busy={busy} run={run} onUpdate={onPaymentUpdate} />
        </main>
      </div>
    );
  }
  if (payment?.status === "succeeded") {
    return (
      <PaymentDone
        receipt={receipts.find((r) => r.paymentId === payment.id) ?? null}
        billFullyPaid={bill.status === "paid"}
        onBack={() => setPayment(null)}
      />
    );
  }

  const open = bill.status === "open" || bill.status === "partially_paid";
  const screen: Step = open ? step : "bill";

  if (screen === "items") {
    return (
      <ItemsStep
        view={view}
        selected={selectedItems}
        onChange={setSelectedItems}
        amountMinor={amountMinor}
        onBack={() => window.history.back()}
        onContinue={() => go("checkout")}
        banner={errorBanner}
      />
    );
  }
  if (screen === "shares") {
    return (
      <SharesStep
        view={view}
        busy={busy}
        shareCount={shareCount}
        onShareCount={setShareCount}
        amountMinor={amountMinor}
        onSplit={(n) => void run(async () => setView(await api.setEqualSplit(billId, n)))}
        onRemove={() => void run(async () => setView(await api.removeEqualSplit(billId)))}
        onBack={() => window.history.back()}
        onContinue={() => go("checkout")}
        banner={errorBanner}
      />
    );
  }
  if (screen === "checkout") {
    return (
      <Checkout
        view={view}
        mode={mode}
        itemCount={selectedItems.size}
        shareCount={shareCount}
        amountMinor={amountMinor}
        tipMinor={tipMinor}
        tipPercent={tipPercent}
        onTip={setTipPercent}
        method={method}
        onMethod={setChosenMethod}
        busy={busy}
        onPay={() => void pay()}
        onBack={() => window.history.back()}
        banner={errorBanner}
      />
    );
  }

  const ended = payment && endedMessage(payment, t);
  return (
    <div className="app">
      <TopBar />
      <main>
        <h1 className="venue">{bill.venueName}</h1>
        <p className="table-chip">{bill.tableLabel}</p>
        {errorBanner}
        {ended && <div className="banner banner-warn">{ended}</div>}
        <BillCard view={view} />
        {bill.status === "paid" && (
          <section className="paid-note">
            <span className="tick">
              <IconCheck size={28} />
            </span>
            <div>
              <h2>{t.billPaidTitle}</h2>
              <p className="muted">{t.billPaidHint}</p>
            </div>
          </section>
        )}
        {bill.status === "closed" && (
          <section className="paid-note">
            <div>
              <h2>{t.billClosedTitle}</h2>
              <p className="muted">{t.billClosedHint}</p>
            </div>
          </section>
        )}
        {open && <ModeChooser view={view} onChoose={startMode} />}
        <ReceiptsList receipts={receipts} />
      </main>
    </div>
  );
}

function endedMessage(payment: PaymentView, t: ReturnType<typeof useI18n>["t"]): string | undefined {
  if (payment.failureReason === "reference_not_found") return t.referenceNotFound;
  if (payment.failureReason?.startsWith("rejected_by_staff")) return t.rejectedByStaff;
  return t.ended[payment.status];
}

function ModeChooser({ view, onChoose }: { view: TableBillView; onChoose: (mode: PaymentMode) => void }) {
  const { t, money } = useI18n();
  const { bill, equalSplit, modes } = view;
  // Anyone can start a split while nobody has paid a share yet, even before one exists.
  const canSplit = modes.shares || (modes.full && !equalSplit?.frozen);
  if (!modes.full && !modes.items && !canSplit) return <div className="banner banner-warn">{t.nothingToPay}</div>;

  return (
    <section className="choices">
      <h2>{t.howToPay}</h2>
      <Choice
        icon={<IconBill />}
        title={t.payAll}
        hint={money(bill.remainingMinor, bill.currency)}
        disabled={!modes.full}
        onClick={() => onChoose("full")}
      />
      <Choice
        icon={<IconDish />}
        title={t.payItems}
        hint={equalSplit?.frozen ? t.payItemsBlocked : t.payItemsHint}
        disabled={!modes.items}
        onClick={() => onChoose("items")}
      />
      <Choice
        icon={<IconPeople />}
        title={t.payShares}
        hint={equalSplit ? t.paySharesActive(equalSplit.shareCount) : t.paySharesHint}
        disabled={!canSplit}
        onClick={() => onChoose("shares")}
      />
    </section>
  );
}

function Choice(props: { icon: React.ReactNode; title: string; hint: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="choice" disabled={props.disabled} onClick={props.onClick}>
      <span className="choice-icon">{props.icon}</span>
      <span className="choice-text">
        <strong>{props.title}</strong>
        <small>{props.hint}</small>
      </span>
      <IconChevron size={20} />
    </button>
  );
}
