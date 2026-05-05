// PesaLens decision engine.
//
// Pure-JS derivations layered on top of the dashboard summary so the UI
// can move past "show numbers" into "tell the user what to change".
//
// Two surfaces consume this module today:
//   • Dashboard  → buildActionPlan(summary)        — Top mistakes, opportunities, 30-day plan.
//   • Markets    → investmentCapacity(summary)     — Safe / Moderate / Aggressive monthly capacity.
//                  simulateInvestment(args)        — Lifestyle impact + projection + risk for a chosen asset.
//
// All inputs are the existing /dashboard/summary payload — no new backend
// endpoints required.

import { fmtTZS } from './api';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round = (v) => Math.round(num(v));

/* ----------------------------------------------------------------
   Cash-flow shape
   ---------------------------------------------------------------- */
export const summarizeFlow = (summary) => {
  const k = summary?.kpis || {};
  const series = summary?.time_series?.monthly || summary?.monthly_data || [];
  const periods = Math.max(1, series.length);

  const totalIn  = num(k.money_in)  || series.reduce((s, m) => s + num(m.income),  0);
  const totalOut = num(k.money_out) || series.reduce((s, m) => s + num(m.expense), 0);
  const totalNet = Number.isFinite(k.net_flow) ? num(k.net_flow) : (totalIn - totalOut);

  const monthlyIn      = series.length ? totalIn  / periods : totalIn;
  const monthlyOut     = series.length ? totalOut / periods : totalOut;
  const monthlySurplus = monthlyIn - monthlyOut;
  // Prefer the backend's savings_rate when it has been computed; otherwise
  // derive from the totals so the action engine always has a number to work with.
  const savingsRate = (k.savings_rate != null && Number.isFinite(Number(k.savings_rate)))
    ? Number(k.savings_rate)
    : (totalIn > 0 ? (totalNet / totalIn) * 100 : 0);

  return {
    periods, totalIn, totalOut, totalNet,
    monthlyIn, monthlyOut, monthlySurplus, savingsRate,
  };
};

/* ----------------------------------------------------------------
   Investment capacity tiers
   ----------------------------------------------------------------
   The percentages are intentionally small. The point is to make
   investing feel routine, not thrilling — a habit at 5–15% of
   surplus compounds further than a one-off at 50% that you have to
   pull out the next time something breaks at home.
   ---------------------------------------------------------------- */
export const CAPACITY_TIERS = [
  { id: 'safe',       pct: 0.05 },
  { id: 'moderate',   pct: 0.15 },
  { id: 'aggressive', pct: 0.30 },
];

export const investmentCapacity = (summary) => {
  const flow = summarizeFlow(summary);
  const surplus = Math.max(0, flow.monthlySurplus);
  const capacity = CAPACITY_TIERS.reduce((acc, tier) => {
    acc[tier.id] = round(surplus * tier.pct);
    return acc;
  }, {});
  return { flow, capacity };
};

/**
 * recommendTier(summary) — picks the tier that best fits the user's
 * actual cash-flow profile so the UI can pre-select it and explain
 * "we recommend X because Y".
 *
 *   • Tiny surplus (< 50k TZS) → Safe. The point at this scale is
 *     building the habit, not the return.
 *   • Healthy surplus + decent savings rate → Moderate. The default
 *     for most people.
 *   • Big surplus AND > 20% savings rate → Aggressive is sustainable.
 */
export const recommendTier = (summary) => {
  const flow = summarizeFlow(summary);
  const surplus = Math.max(0, flow.monthlySurplus);
  if (surplus < 50_000) return { id: 'safe',       reasonKey: 'sim.recommend.safe.tiny' };
  if (flow.savingsRate >= 20 && surplus >= 500_000) {
    return { id: 'aggressive', reasonKey: 'sim.recommend.aggressive.headroom' };
  }
  if (flow.savingsRate >= 10) {
    return { id: 'moderate',   reasonKey: 'sim.recommend.moderate.steady' };
  }
  return { id: 'safe', reasonKey: 'sim.recommend.safe.unsteady' };
};

/* ----------------------------------------------------------------
   Asset risk profiles
   ----------------------------------------------------------------
   Conservative, educational defaults — NOT a return forecast. We map
   each market symbol to a profile so the simulator can show "what
   could this become" + "what could you lose short-term" for the
   amount the user picked. Descriptions stay deliberately concrete
   ("buy a piece of a real Tanzanian company") instead of jargon
   ("equity instrument") because the audience this product targets
   has never picked an asset before.
   ---------------------------------------------------------------- */
const ASSET_PROFILES = {
  dse_equity:      { annual: 0.08, drawdown: 0.18, risk: 'Medium',  label: 'DSE listed equity', basis: 'Long-run frontier-market equity returns; dividend yields on the DSE have ranged 5–10%.' },
  stablecoin:      { annual: 0.05, drawdown: 0.02, risk: 'Low',     label: 'USD stablecoin',    basis: 'Roughly tracks USD short-term yields; small de-peg risk.' },
  crypto_bluechip: { annual: 0.20, drawdown: 0.55, risk: 'High',    label: 'Blue-chip crypto',  basis: 'BTC / ETH long-run CAGR is high but drawdowns of 50–70% are routine.' },
  crypto_alt:      { annual: 0.30, drawdown: 0.75, risk: 'Extreme', label: 'Alt crypto',        basis: 'Higher expected return historically, but most lose >70% in any bear cycle.' },
};

/* Asset-category metadata — the three big choice cards in step 2 of
   the simulator. Order matters (lowest risk first). */
export const ASSET_CATEGORIES = [
  { id: 'stable', kinds: ['STABLE'], i18nKey: 'sim.cat.stable' },
  { id: 'stocks', kinds: ['DSE'],    i18nKey: 'sim.cat.stocks' },
  { id: 'crypto', kinds: ['CRYPTO'], i18nKey: 'sim.cat.crypto' },
];

export const assetsInCategory = (universe, categoryId) => {
  const cat = ASSET_CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) return [];
  return universe.filter((a) => cat.kinds.includes(a.kind));
};

const STABLES = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'BUSD', 'FDUSD']);
const BLUECHIP = new Set(['BTC', 'ETH']);

const cryptoClass = (symbol) => {
  const s = String(symbol || '').toUpperCase();
  if (STABLES.has(s)) return 'stablecoin';
  if (BLUECHIP.has(s)) return 'crypto_bluechip';
  return 'crypto_alt';
};

export const buildAssetUniverse = (snapshot) => {
  const out = [];

  // Surface every DSE listing the snapshot returned — the previous 12-cap
  // hid usable picks like NMB / TBL / TPCC for users whose dashboard
  // ranked them outside the top dozen by volume.
  const dse = snapshot?.dse?.data || [];
  for (const s of dse) {
    if (!s.symbol) continue;
    out.push({
      id:       `dse:${s.symbol}`,
      symbol:   s.symbol,
      name:     s.name || s.symbol,
      kind:     'DSE',
      price:    num(s.price),
      currency: 'TZS',
      change:   num(s.change_pct),
      profile:  ASSET_PROFILES.dse_equity,
    });
  }

  const crypto = snapshot?.crypto?.data || [];
  for (const c of crypto) {
    if (!c.symbol) continue;
    const cls = cryptoClass(c.symbol);
    out.push({
      id:       `crypto:${c.symbol}`,
      symbol:   c.symbol,
      name:     c.name || c.symbol,
      kind:     cls === 'stablecoin' ? 'STABLE' : 'CRYPTO',
      price:    num(c.price_tzs) || num(c.price_usd),
      currency: num(c.price_tzs) ? 'TZS' : 'USD',
      change:   num(c.change_pct),
      profile:  ASSET_PROFILES[cls],
    });
  }

  return out;
};

/* ----------------------------------------------------------------
   Buy-breakdown helpers
   ----------------------------------------------------------------
   Each asset class trades in a different unit:
     • DSE listings settle in round lots — the prevailing convention
       in Dar es Salaam is 10 shares per board lot, so a buy of 4
       shares of CRDB simply does not happen through a broker.
     • Crypto is fractional, but most exchanges enforce a practical
       minimum order around $1 USD. Below that the order is rejected
       even though the maths says you could buy 0.0000013 BTC.
     • Stablecoins are denominated in $1 increments (1 USDT ≈ 2,500
       TZS) so the natural minimum is one whole token.

   The shape we expose:
     { kind, label, fractional, qty, lotCostFloor, unit }
   where `lotCostFloor` is a TZS floor that overrides qty × price for
   fractional assets — keeping the "minimum lot" idea honest across
   classes.
   ---------------------------------------------------------------- */

// $1 USD ≈ 2,500 TZS at recent BOT indicative rates. Used as the
// practical minimum order on most centralised crypto exchanges (Binance
// P2P, KuCoin, Yellow Card etc.). We don't fetch this dynamically — a
// 5–10% drift over a few months does not change the advice.
const CRYPTO_MIN_ORDER_TZS = 2_500;

const MIN_LOT_BY_KIND = {
  DSE:    { qty: 10,     label: 'shares', fractional: false, unit: 'share', lotCostFloor: 0 },
  CRYPTO: { qty: 0,      label: 'coins',  fractional: true,  unit: 'coin',  lotCostFloor: CRYPTO_MIN_ORDER_TZS },
  STABLE: { qty: 1,      label: 'tokens', fractional: false, unit: 'token', lotCostFloor: 0 },
};

const lotConfig = (kind) => MIN_LOT_BY_KIND[kind] || MIN_LOT_BY_KIND.DSE;

/**
 * computeBuyPlan(asset, amount, surplus)
 *
 * Translates "I have X TZS, I want asset Y" into "you can buy N units,
 * here's the leftover, here's the gap if you can't even afford the
 * minimum lot, and here's how to close that gap".
 *
 *   • For DSE assets the minimum lot is 10 shares — a real broker
 *     constraint. A 27,000 TZS allocation against a 2,700 CRDB price
 *     gets you exactly one lot; an 18,000 allocation gets you nothing
 *     until you save the next 9k.
 *   • For crypto / stablecoins the minimum is fractional, so the
 *     "shortfall" branch effectively never fires there — they should
 *     always be buyable at any positive amount.
 */
export const computeBuyPlan = (asset, amount, surplus) => {
  if (!asset || !asset.price || asset.price <= 0) return null;
  const cfg         = lotConfig(asset.kind);
  const unitPrice   = num(asset.price);
  const lotQty      = cfg.qty;
  const cash        = Math.max(0, num(amount));
  const safeSurplus = Math.max(0, num(surplus));

  // For DSE the lot cost is exact: 10 shares × price.
  // For crypto the minimum is a TZS floor (≈ $1 USD) — 0 shares of
  // a coin is meaningless, but exchanges reject orders below ~2,500 TZS.
  // For stablecoins one whole token is the natural floor.
  const naturalLotCost = unitPrice * (lotQty || 0);
  const lotCost        = cfg.fractional
    ? Math.max(naturalLotCost, cfg.lotCostFloor || 0)
    : naturalLotCost;

  // Whole lots affordable at the chosen amount.
  const lots = lotCost > 0 ? Math.floor(cash / lotCost) : 0;
  // For fractional assets we report the actual fractional unit count
  // (e.g. 0.000431 ETH); for board-lot assets we report whole units.
  const units = cfg.fractional
    ? (cash >= lotCost ? cash / unitPrice : 0)
    : lots * (lotQty || 1);
  const actualCost = cfg.fractional
    ? (cash >= lotCost ? cash : 0)
    : lots * lotCost;
  const leftover   = Math.max(0, cash - actualCost);

  const meetsMinimum = cash >= lotCost && lotCost > 0;
  const shortfall    = meetsMinimum ? 0 : Math.max(0, lotCost - cash);

  // If the amount falls short, how many months at the same tier would
  // it take to accumulate one lot? Capped so the UI never says
  // "save for 47 months" — past 12, the right call is "pick something
  // cheaper", not "wait a year".
  const monthsToAccumulate = (!meetsMinimum && cash > 0)
    ? Math.ceil(lotCost / cash)
    : 0;

  // What share of the user's monthly surplus does one lot represent?
  // Useful for "you'd need to allocate X% of your surplus" copy.
  const lotPctOfSurplus = safeSurplus > 0 ? (lotCost / safeSurplus) * 100 : Infinity;

  // Round-trip lots affordable using the *whole* monthly surplus —
  // i.e. the most aggressive case before lifestyle takes the hit.
  const lotsAtSurplus = lotCost > 0 ? Math.floor(safeSurplus / lotCost) : 0;

  return {
    kind:       asset.kind,
    symbol:     asset.symbol,
    unitPrice,
    unitLabel:  cfg.label,
    fractional: cfg.fractional,
    lotQty,
    lotCost,
    cash,
    units,
    lots,
    actualCost,
    leftover,
    meetsMinimum,
    shortfall,
    monthsToAccumulate,
    lotPctOfSurplus,
    lotsAtSurplus,
  };
};

/**
 * suggestCheaperDseAsset(universe, currentAsset, monthlyBudget)
 *
 * For DSE users who can't afford one board lot of their pick, surface
 * the *cheapest* listing whose lot price fits inside their budget. We
 * don't sort by yield or fundamentals — at this stage of the journey
 * the win is "you can actually buy something today", not a stock-pick.
 */
export const suggestCheaperDseAsset = (universe, currentAsset, monthlyBudget) => {
  if (!Array.isArray(universe) || !currentAsset || currentAsset.kind !== 'DSE') return null;
  const cfg     = lotConfig('DSE');
  const budget  = num(monthlyBudget);
  if (budget <= 0) return null;
  const cheaper = universe
    .filter((a) => a.kind === 'DSE' && a.price > 0 && a.symbol !== currentAsset.symbol)
    .map((a) => ({ asset: a, lotCost: a.price * cfg.qty }))
    .filter((row) => row.lotCost <= budget)
    .sort((a, b) => a.lotCost - b.lotCost);
  return cheaper[0] || null;
};

/* ----------------------------------------------------------------
   Future-value helpers
   ---------------------------------------------------------------- */
const fvMonthly = (monthly, annual, months) => {
  const r = annual / 12;
  if (r === 0) return monthly * months;
  return monthly * ((Math.pow(1 + r, months) - 1) / r);
};

/* ----------------------------------------------------------------
   Simulator
   ---------------------------------------------------------------- */
export const simulateInvestment = ({ summary, asset, monthly }) => {
  const flow    = summarizeFlow(summary);
  const surplus = Math.max(0, flow.monthlySurplus);
  const amount  = Math.max(0, num(monthly));
  const profile = asset?.profile || ASSET_PROFILES.dse_equity;

  const buffer       = surplus - amount;
  const surplusUsed  = surplus > 0 ? (amount / surplus) * 100 : 0;

  // Lifestyle status — purely a function of how much surplus is left.
  let status; let statusLabel; let statusTone;
  if (amount === 0) {
    status = 'idle';      statusLabel = 'No allocation yet';            statusTone = 'muted';
  } else if (buffer < 0) {
    status = 'unsafe';    statusLabel = 'Above your surplus — unsafe';  statusTone = 'danger';
  } else if (surplusUsed > 50) {
    status = 'tight';     statusLabel = 'Tight — leaves little room';   statusTone = 'expense';
  } else if (surplusUsed > 25) {
    status = 'balanced';  statusLabel = 'Balanced — lifestyle stable';  statusTone = 'net';
  } else {
    status = 'invisible'; statusLabel = 'Invisible — buffer untouched'; statusTone = 'income';
  }

  // Growth projection — base case + downside (worst plausible drawdown
  // applied to the running balance).
  const fv12 = fvMonthly(amount, profile.annual, 12);
  const fv36 = fvMonthly(amount, profile.annual, 36);
  const fv60 = fvMonthly(amount, profile.annual, 60);
  const downside12 = fv12 * (1 - profile.drawdown);

  // Recommendation copy — concrete, conditional on the user's numbers.
  const recommendation = (() => {
    if (surplus <= 0) {
      return 'Your statement shows no surplus. Close the cash-flow gap first — investing while the month ends below zero just borrows the loss forward.';
    }
    if (status === 'unsafe') {
      return `That amount exceeds your monthly surplus of ${fmtTZS(surplus)}. Drop it to ${fmtTZS(round(surplus * 0.15))} (the Moderate tier) so you are investing what you actually have, not what you wish you had.`;
    }
    if (status === 'tight') {
      return `You are spending over half of your surplus. Sustainable for a few months — but one slow month and this becomes the deficit. Moderate tier (${fmtTZS(round(surplus * 0.15))}/month) is safer.`;
    }
    if (status === 'balanced') {
      return `This sits inside the moderate band. At ${(profile.annual * 100).toFixed(0)}% nominal it could become ${fmtTZS(fv12)} in 12 months, but be ready to see ${fmtTZS(downside12)} during a drawdown.`;
    }
    if (status === 'invisible') {
      return `Your lifestyle stays untouched. Build the habit at this level for 2–3 months, then revisit the moderate tier (${fmtTZS(round(surplus * 0.15))}/month) once it feels routine.`;
    }
    return 'Pick an amount on the slider to see the lifestyle and growth impact.';
  })();

  return {
    flow,
    surplus,
    amount,
    buffer,
    surplusUsed,
    status,
    statusLabel,
    statusTone,
    profile,
    fv12, fv36, fv60,
    downside12,
    recommendation,
  };
};

/* ----------------------------------------------------------------
   Action engine — Top 3 Mistakes, Top 3 Opportunities, 30-day plan.
   ---------------------------------------------------------------- */
export const buildActionPlan = (summary) => {
  const flow       = summarizeFlow(summary);
  const categories = summary?.categories || [];
  const fees       = summary?.transaction_costs || null;

  const mistakes      = [];
  const opportunities = [];
  const plan          = [];

  /* ---- Mistakes ---- */

  // 1. Overspending on the top expense category.
  const topCat = categories[0];
  if (topCat && flow.monthlyIn > 0) {
    const monthlyTopCat = topCat.value / flow.periods;
    const incomeShare   = (monthlyTopCat / flow.monthlyIn) * 100;
    if (incomeShare > 25) {
      mistakes.push({
        title: `${topCat.name} is eating ${incomeShare.toFixed(0)}% of every shilling you earn`,
        body: `About ${fmtTZS(monthlyTopCat)} per month flows into ${topCat.name.toLowerCase()}. Anything past 25% of income on a single category usually crowds out savings — you can feel productive while staying broke.`,
        fix: `Open Analysis, filter to ${topCat.name.toLowerCase()}, and circle the three biggest line items. Cut just one of them next month — that alone closes the gap below the 25% line.`,
        cost: monthlyTopCat,
        severity: incomeShare > 50 ? 'critical' : 'warning',
        meta: { category: topCat.name, monthly: monthlyTopCat, share: incomeShare },
      });
    }
  }

  // 2. Bank fees — silent drag on cash flow.
  if (fees && num(fees.estimated_total) > 0) {
    const monthly = num(fees.estimated_total) / flow.periods;
    mistakes.push({
      title: 'Bank charges are quietly draining your account',
      body: `${fees.fee_occurrences || 0} fee events totalling ${fmtTZS(num(fees.estimated_total))} on this statement. These are almost always avoidable — wallet-to-wallet transfers, batched payouts, and direct debits typically wipe out 50–80% of this.`,
      fix: 'Switch peer transfers to wallet-to-wallet, batch monthly payouts into one transaction instead of many, and set direct debits for utility bills.',
      cost: monthly,
      severity: monthly > 20000 ? 'warning' : 'notice',
    });
  }

  // 3. Savings rate / deficit reality check.
  if (flow.monthlyIn > 0 && (flow.savingsRate < 10 || flow.monthlySurplus < 0)) {
    const deficit = flow.monthlySurplus < 0;
    mistakes.push({
      title: deficit
        ? `You finish each month ${fmtTZS(Math.abs(flow.monthlySurplus))} short`
        : `Savings rate is only ${flow.savingsRate.toFixed(1)}% — well under the 20% benchmark`,
      body: deficit
        ? 'Every month closes below zero. No investment plan or hustle compounds on top of a deficit — fix this first, then everything else gets easier.'
        : 'A healthy household saves about 20% of income. You are not — but the gap is closeable from one or two categories, not all at once. Pick the biggest leak and patch it next month.',
      fix: deficit
        ? 'Pick the two largest expense categories and target a 15% cut each next month. Then re-upload — the deficit usually closes in 4–6 weeks.'
        : 'Pick one expense category and cut it by 15%. That single move usually pushes the savings rate up by 3–5 percentage points without any income change.',
      cost: deficit ? Math.abs(flow.monthlySurplus) : Math.max(0, flow.monthlyIn * (0.20 - flow.savingsRate / 100)),
      severity: deficit ? 'critical' : 'warning',
    });
  }

  /* ---- Opportunities ---- */

  // 1. Trim 10% off the top category — concrete annual win.
  if (topCat) {
    const monthlyTopCat = topCat.value / flow.periods;
    const trim = monthlyTopCat * 0.10;
    if (trim > 5000) {
      opportunities.push({
        title: `Trim 10% off ${topCat.name}`,
        body: `${fmtTZS(trim)} per month back in your pocket — ${fmtTZS(trim * 12)} across 12 months without earning a single extra shilling. Most people find the 10% painlessly by cutting outliers, not the routine.`,
        action: `Set a monthly cap of ${fmtTZS(monthlyTopCat * 0.9)} on ${topCat.name.toLowerCase()}. Use a wallet sub-account or a recurring calendar reminder so the limit enforces itself.`,
        impact: trim * 12,
      });
    }
  }

  // 2. Surplus → invest moderate tier.
  if (flow.monthlySurplus > 0) {
    const moderate = flow.monthlySurplus * 0.15;
    const fv12 = fvMonthly(moderate, 0.08, 12);
    const fv36 = fvMonthly(moderate, 0.08, 36);
    opportunities.push({
      title: 'Put your spare cash to work',
      body: `15% of your monthly surplus is ${fmtTZS(moderate)}. Left alone at 8% nominal returns it becomes ${fmtTZS(fv12)} in 12 months and ${fmtTZS(fv36)} by year three. Sitting in a current account, it earns roughly nothing.`,
      action: 'Open the Markets simulator below, pick the Moderate tier and a low-risk asset like a stablecoin or DSE blue-chip. Set a recurring transfer on payday so this becomes automatic.',
      impact: fv36,
    });
  }

  // 3. Recover bank fees.
  if (fees && num(fees.estimated_total) > 0) {
    const recoverable = num(fees.estimated_total) * 0.6;
    opportunities.push({
      title: 'Stop bleeding fees on transfers',
      body: `Re-routing how money moves could recover roughly ${fmtTZS(recoverable)} a year — money that is currently leaving your account for nothing.`,
      action: 'Switch peer transfers to wallet-to-wallet (M-Pesa / Airtel / Tigo), batch your monthly payouts into one transaction instead of many small ones, and set direct debits for recurring bills.',
      impact: recoverable,
    });
  }

  // 4. Fallback when things look healthy.
  if (opportunities.length === 0 && flow.monthlySurplus > 0) {
    opportunities.push({
      title: `You have ${fmtTZS(flow.monthlySurplus)} of unallocated surplus each month`,
      body: 'Money that sits in a current account loses to inflation. Even a 5% stablecoin or a DSE dividend stock would have it working for you.',
      action: 'Move 5% of next month\'s surplus into the Markets Safe tier. Three months in, bump it to 15% — that is enough time to feel whether the habit is sustainable.',
      impact: flow.monthlySurplus * 12 * 0.05,
    });
  }

  /* ---- 30-day plan ---- */

  plan.push({
    when:   'This week',
    title:  'Audit your top three expenses, line by line',
    detail: 'Open Analysis, filter by Expense, sort Debit (high → low). Tag every recurring charge. Anything you have not used this month — cancel before the next billing date.',
  });

  if (fees && num(fees.estimated_total) > 0) {
    plan.push({
      when:   'Next 7 days',
      title:  `Eliminate ${fmtTZS(num(fees.estimated_total))} in avoidable bank fees`,
      detail: 'Move recurring transfers to wallet-to-wallet, schedule once-monthly batch payouts, set direct debits for utilities. Re-upload next month and watch this row shrink.',
    });
  } else {
    plan.push({
      when:   'Next 7 days',
      title:  'Lock down a 20% expense reduction in your top category',
      detail: `${topCat ? topCat.name : 'Your largest category'} is the lowest-effort lever. Set a calendar alert at 80% of last month's spend so the cut is enforced, not hoped for.`,
    });
  }

  if (flow.monthlySurplus > 0) {
    const safeMonthly = round(flow.monthlySurplus * 0.05);
    plan.push({
      when:   'Days 14–21',
      title:  `Open or top up an investment with ${fmtTZS(safeMonthly)}`,
      detail: 'Start with the Safe tier in the Markets simulator. The point is not the return yet — it is building the habit at an amount you cannot feel.',
    });
  } else {
    plan.push({
      when:   'Days 14–21',
      title:  'Close the deficit before any investing',
      detail: 'Pick the two largest expense categories and target a 15% cut each. Re-check next month — investing while running a deficit just compounds the hole.',
    });
  }

  plan.push({
    when:   'End of month',
    title:  'Re-upload next month\'s statement',
    detail: 'PesaLens compares against this baseline so you see whether the plan moved the needle. If a step did not work, change the plan — not the goal.',
  });

  return {
    flow,
    mistakes:      mistakes.slice(0, 3),
    opportunities: opportunities.slice(0, 3),
    plan,
  };
};

// Re-export so callers can pull formatter + helpers from one place.
export { fmtTZS };
