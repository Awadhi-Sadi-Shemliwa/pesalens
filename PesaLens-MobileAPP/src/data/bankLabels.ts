// BankFormat value → display label. Single source of truth for the whole
// mobile app (mirrors backend reconciliation.BANK_LABEL). Acronym banks stay
// upper-case; mobile-money brands read as words.
export const BANK_LABEL: Record<string, string> = {
  crdb: "CRDB", nmb: "NMB", nbc: "NBC", kcb: "KCB", absa: "Absa", amana: "Amana",
  mpesa: "M-Pesa", airtel_money: "Airtel Money", tigo_pesa: "Tigo Pesa",
  halo_pesa: "Halo Pesa", selcom: "Selcom", yas: "Yas", unknown: "Unknown",
};

// `fallback` is what to show when the bank is unknown/absent — callers differ
// ("Statement" on the Dashboard/ledgers, null where a missing bank means "hide").
export const bankLabel = (b?: string | null, fallback: string | null = null): string | null =>
  b ? BANK_LABEL[String(b).toLowerCase()] || String(b).toUpperCase() : fallback;
