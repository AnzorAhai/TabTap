import type { PaymentMethod } from "@tabtap/shared";

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  card: "Карта",
  pago_movil: "Pago Móvil (Bs)",
  zelle: "Zelle (USD)",
  binance_pay: "Binance Pay (USDT)",
  cash_usd: "Наличные USD",
  cash_ves: "Наличные Bs",
};

/** Labels for the payee details a restaurant sets up per method. */
export const PAY_TO_LABEL: Record<string, string> = {
  bank: "Банк",
  phone: "Телефон",
  documentId: "RIF / C.I.",
  holderName: "Получатель",
  email: "Email",
  payId: "Binance Pay ID",
};
