import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { Eyebrow, Badge } from './common';
import { TiltCard } from './motion';
import { ChartJS, chartTheme } from './ChartJS';
import {
  ASSET_CATEGORIES,
  CAPACITY_TIERS,
  assetsInCategory,
  buildAssetUniverse,
  computeBuyPlan,
  fmtTZS,
  investmentCapacity,
  recommendTier,
  simulateInvestment,
  suggestCheaperDseAsset,
} from '../data/decisions';
import { fmtTZSFull } from '../data/api';
import { useT, AutoT } from '../data/i18n';

/* ----------------------------------------------------------------
   Investment Simulator — three-step decision wizard.
   ----------------------------------------------------------------
   Layout decisions:
     • One vertical column on mobile, expanding to multi-column at
       lg breakpoint only. Tablet stays stacked because the cards
       are content-heavy and benefit from full width.
     • Each step is its own card with eyebrow + plain-English title
       + one-sentence lede so users always know what they are doing.
     • No slider — three big tappable tier cards do the picking.
       The user asked "should I pick safe or aggressive?" so each
       card carries a "Best if you..." line, and one is marked
       Recommended based on the user's actual cash flow.
   ---------------------------------------------------------------- */

const TIER_THEME = {
  safe:       { ring: 'ring-inc/50', accent: 'text-inc', dot: 'bg-inc', border: 'border-inc/30', glow: 'bg-inc/15' },
  moderate:   { ring: 'ring-net/50', accent: 'text-net', dot: 'bg-net', border: 'border-net/30', glow: 'bg-net/15' },
  aggressive: { ring: 'ring-dng/50', accent: 'text-dng', dot: 'bg-dng', border: 'border-dng/30', glow: 'bg-dng/15' },
};

const CATEGORY_THEME = {
  stable: { chip: 'bg-inc/10',    accent: 'text-inc',    border: 'border-inc/30',    glow: 'bg-inc/15',    icon: 'shield' },
  stocks: { chip: 'bg-accent/10', accent: 'text-accent', border: 'border-accent/30', glow: 'bg-accent/15', icon: 'chart' },
  crypto: { chip: 'bg-dng/10',    accent: 'text-dng',    border: 'border-dng/30',    glow: 'bg-dng/15',    icon: 'zap'   },
};

const RISK_BADGE = {
  Low:     'income',
  Medium:  'net',
  High:    'expense',
  Extreme: 'danger',
};

const fmtPct = (v) => {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
};

/* ----------------------------------------------------------------
   StepCard — generic wrapper used by each of the three steps so
   the visual hierarchy is identical across them.
   ---------------------------------------------------------------- */
const StepCard = ({ stepEyebrow, title, lede, children, className = '' }) => (
  <section className={`bento p-4 sm:p-6 lg:p-8 ${className}`}>
    <div className="mb-5 sm:mb-6">
      <Eyebrow>{stepEyebrow}</Eyebrow>
      <h2 className="mt-2.5 text-lg sm:text-xl lg:text-2xl font-semibold tracking-tight break-words">
        {title}
      </h2>
      {lede && (
        <p className="mt-2 text-sm sm:text-base text-txt-2 leading-relaxed max-w-2xl break-words">
          {lede}
        </p>
      )}
    </div>
    {children}
  </section>
);

/* ----------------------------------------------------------------
   HeroBlock — anchors the page with the headline number AND the
   step-by-step math that produces it. Users were asking "where did
   that number come from?" — so we now lay it out as a literal chain:
   Money in − Money out (incl. fees) = Surplus → tier % = Investable.
   ---------------------------------------------------------------- */
const FlowChainRow = ({ label, value, sign, tone = 'muted', bold = false, indent = false }) => {
  const toneCls = {
    inc:    'text-inc',
    exp:    'text-exp',
    net:    'text-net',
    accent: 'text-accent',
    dng:    'text-dng',
    muted:  'text-txt-3',
  }[tone] || 'text-txt-3';
  return (
    <div className={`flex items-center gap-3 ${indent ? 'pl-4' : ''}`}>
      <span className={`w-4 text-center font-mono text-xs ${toneCls}`}>{sign || ''}</span>
      <span className={`flex-1 ${indent ? 'text-txt-3 text-xs' : 'text-sm text-txt-2'} break-words`}>
        {label}
      </span>
      <span className={`font-mono tabular text-right ${toneCls} ${bold ? 'font-bold text-base sm:text-lg' : 'text-sm sm:text-base'} break-all`}>
        {value}
      </span>
    </div>
  );
};

const HeroBlock = ({ flow, fees, headline, tierPct, tierLabel, t }) => {
  const surplus = Math.max(0, flow.monthlySurplus);
  // Real spending = total outflow minus fees, so the chain
  // reconciles: in − spending − fees = surplus. Floor at 0 so a
  // statement where fees overshoot total outflow still renders.
  const spending = Math.max(0, flow.monthlyOut - (fees || 0));
  return (
    <section className="bento p-4 sm:p-6 lg:p-8 relative overflow-hidden border-accent/20">
      <div className="absolute -right-24 -top-24 w-72 h-72 bg-accent/10 rounded-full blur-3xl pointer-events-none" />
      <div className="relative">
        <Eyebrow>{t('sim.hero.eyebrow')}</Eyebrow>
        <p className="mt-3 text-sm sm:text-base text-txt-2 leading-relaxed max-w-xl">
          {t('sim.hero.title')}
        </p>
        <div className="mt-2 flex items-baseline flex-wrap gap-x-3 gap-y-1">
          <span className="text-3xl sm:text-5xl lg:text-6xl font-bold tabular text-accent break-all">
            {fmtTZS(headline)}
          </span>
          <span className="text-sm sm:text-base text-txt-2">{t('sim.hero.subtitle')}</span>
        </div>
        <p className="mt-4 text-sm text-txt-2 leading-relaxed max-w-2xl">
          {t('sim.hero.explainer')}
        </p>

        {/* Math chain — Money out is split into Spending and Fees so
            users can see the rows actually reconcile to the surplus.
            Full TZS amounts (not 1.59M shorthand) so the math adds up
            visually instead of leaving rounding gaps that read as bugs. */}
        <div className="mt-5 sm:mt-6 surface-inset rounded-xl p-3 sm:p-4 space-y-2">
          <div className="text-[10px] sm:text-xs uppercase tracking-ticker text-txt-3 font-mono mb-1">
            How we got there (per month)
          </div>
          <FlowChainRow
            label="Money you received"
            value={fmtTZSFull(flow.monthlyIn)}
            sign="+"
            tone="inc"
          />
          <FlowChainRow
            label="Spending (excl. fees)"
            value={fmtTZSFull(spending)}
            sign="−"
            tone="exp"
          />
          <FlowChainRow
            label="Bank & wallet fees"
            value={fmtTZSFull(fees || 0)}
            sign="−"
            tone="exp"
          />
          <div className="hairline my-1" />
          <FlowChainRow
            label="Surplus left at month-end"
            value={fmtTZSFull(flow.monthlySurplus)}
            sign="="
            tone={surplus > 0 ? 'net' : 'dng'}
            bold
          />
          <FlowChainRow
            label={`Investable (${tierPct}% of surplus · ${tierLabel})`}
            value={fmtTZSFull(headline)}
            sign="→"
            tone="accent"
            bold
          />
        </div>
        <p className="mt-3 text-xs text-txt-3 leading-relaxed max-w-2xl">
          <span className="font-semibold text-txt-2">Why these numbers:</span>{' '}
          "Money out" on the dashboard is the sum of Spending and Fees — they aren't deducted twice. Surplus is what literally remains in your account each month after both.
        </p>
      </div>
    </section>
  );
};

/* ----------------------------------------------------------------
   TierCard — one of the three big amount choices.
   ---------------------------------------------------------------- */
const TierCard = ({ tier, value, active, recommended, onPick, t }) => {
  const theme = TIER_THEME[tier.id];
  return (
    <TiltCard max={6} className="h-full">
      <button
        type="button"
        onClick={() => onPick(value)}
        aria-pressed={active}
        className={`relative w-full h-full text-left glass-pane rounded-2xl border p-4 sm:p-5 transition-all min-h-[160px] overflow-hidden
          ${active ? `${theme.border} ring-2 ${theme.ring}` : 'border-bdr/60 hover:border-bdr-hover'}`}
      >
        <span aria-hidden className={`absolute -right-10 -top-10 w-28 h-28 rounded-full blur-2xl ${theme.glow} pointer-events-none transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`} />
        {recommended && (
          <span className="absolute -top-2.5 right-3 text-[10px] uppercase tracking-ticker font-semibold px-2 py-0.5 rounded-full btn-primary shadow-md">
            {t('sim.step1.recommend')}
          </span>
        )}
        <div className="relative flex items-center gap-2 mb-2">
          <span className={`w-2 h-2 rounded-full ${theme.dot}`} />
          <span className={`text-xs uppercase tracking-ticker font-semibold ${theme.accent}`}>
            {t(`sim.tier.${tier.id}.title`)}
          </span>
        </div>
        <div className="relative text-2xl sm:text-3xl font-bold tabular text-txt-1 break-all leading-tight">
          {fmtTZS(value)}
        </div>
        <div className="relative text-xs text-txt-3 mt-0.5 mb-3">
          {t(`sim.tier.${tier.id}.short`)}
        </div>
        <p className="relative text-xs sm:text-sm text-txt-2 leading-relaxed break-words">
          {t(`sim.tier.${tier.id}.bestFor`)}
        </p>
      </button>
    </TiltCard>
  );
};

/* ----------------------------------------------------------------
   CategoryCard — one of the three big asset-class choices.
   ---------------------------------------------------------------- */
const CategoryCard = ({ category, profile, active, onPick, t }) => {
  const theme = CATEGORY_THEME[category.id];
  return (
    <TiltCard max={5} className="h-full">
      <button
        type="button"
        onClick={() => onPick(category.id)}
        aria-pressed={active}
        className={`relative w-full h-full text-left glass-pane rounded-2xl border p-4 sm:p-5 transition-all min-h-[200px] overflow-hidden
          ${active ? `${theme.border} ring-2 ring-accent/50` : 'border-bdr/60 hover:border-bdr-hover'}`}
      >
        <span aria-hidden className={`absolute -right-10 -top-10 w-28 h-28 rounded-full blur-2xl ${theme.glow} pointer-events-none transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`} />
        <div className="relative flex items-start gap-3 mb-3">
          <div className={`p-2 rounded-lg ${theme.chip} border ${theme.border} flex-shrink-0`}>
            <Icon name={theme.icon} size={18} className={theme.accent} />
          </div>
          <h3 className="text-base sm:text-lg font-semibold leading-tight break-words">
            {t(`sim.cat.${category.id}.title`)}
          </h3>
        </div>
        <p className="relative text-xs sm:text-sm text-txt-2 leading-relaxed mb-4 break-words">
          {t(`sim.cat.${category.id}.body`)}
        </p>
        <div className="relative grid grid-cols-2 gap-3 mb-3">
          <div className="surface-inset rounded-lg p-2.5">
            <div className="text-[10px] uppercase tracking-ticker text-txt-3">{t('sim.cat.typicalReturn')}</div>
            <div className={`text-base font-bold tabular ${theme.accent}`}>
              ~{(profile.annual * 100).toFixed(0)}%
            </div>
          </div>
          <div className="surface-inset rounded-lg p-2.5">
            <div className="text-[10px] uppercase tracking-ticker text-txt-3">{t('sim.cat.typicalRisk')}</div>
            <div className="text-base font-bold tabular text-txt-1">
              ~{(profile.drawdown * 100).toFixed(0)}%
            </div>
          </div>
        </div>
        <div className="relative text-[11px] text-txt-3 italic break-words">
          {t(`sim.cat.${category.id}.bestFor`)}
        </div>
      </button>
    </TiltCard>
  );
};

/* ----------------------------------------------------------------
   AssetChip — selectable asset within a chosen category.
   The price and lot cost are surfaced on the chip itself so users
   can comparison-shop before clicking — important on DSE where
   lot prices range from a few thousand to several million TZS.
   ---------------------------------------------------------------- */
const AssetChip = ({ asset, active, onPick }) => {
  const isDse  = asset.kind === 'DSE';
  const lotQty = isDse ? 10 : 1;
  const lotCost = (asset.price || 0) * lotQty;
  return (
    <button
      type="button"
      onClick={() => onPick(asset.id)}
      aria-pressed={active}
      className={`text-left rounded-xl border p-3 transition min-h-[88px] flex flex-col gap-1 ${
        active
          ? 'border-accent/60 bg-accent/10 shadow-md'
          : 'border-bdr/60 bg-surface-3/40 hover:border-accent/30 hover:bg-accent/5'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-semibold text-sm text-txt-1 truncate">{asset.symbol}</span>
        <span className={`text-[11px] tabular flex-shrink-0 ${asset.change >= 0 ? 'text-inc' : 'text-dng'}`}>
          {fmtPct(asset.change)}
        </span>
      </div>
      <div className="text-[11px] text-txt-3 truncate">{asset.name}</div>
      {asset.price > 0 && (
        <div className="mt-auto pt-1 text-[11px] tabular text-txt-2 truncate">
          {isDse ? `${fmtTZS(asset.price)} / share` : `${fmtTZS(asset.price)} / ${asset.kind === 'CRYPTO' ? 'coin' : 'token'}`}
          {isDse && (
            <span className="block text-[10px] text-txt-3 truncate">
              Lot of {lotQty}: {fmtTZS(lotCost)}
            </span>
          )}
        </div>
      )}
    </button>
  );
};

/* ----------------------------------------------------------------
   BuyBreakdown — the punchline of step 2.
   ----------------------------------------------------------------
   Once the user has picked both a tier (Step 1) and a specific asset,
   this card answers the question they actually came for: "with that
   amount, how many shares of THIS thing can I actually buy?".
   When the answer is "not enough for one lot", the card pivots to
   coaching: save N months, upgrade tier, or pick a cheaper listing.
   ---------------------------------------------------------------- */
const BuyBreakdown = ({ plan, asset, surplus, capacity, currentTierId, onUpgradeTier, onPickAsset, cheaperSuggestion, stableSuggestion, t }) => {
  if (!plan || !asset) return null;
  const fmtUnits = (n) => {
    if (!Number.isFinite(n) || n <= 0) return '0';
    if (plan.fractional) {
      // Fractional crypto needs more decimals when the unit price is
      // huge (e.g. 0.0000151 BTC). Trim trailing zeros to keep it
      // readable at any magnitude.
      const decimals = n >= 1 ? 4 : (n >= 0.001 ? 6 : 8);
      return n.toFixed(decimals).replace(/\.?0+$/, '');
    }
    return Math.floor(n).toLocaleString('en-US');
  };

  const meets   = plan.meetsMinimum;
  const tone    = meets ? 'inc' : 'dng';
  // Asset-class discriminator drives copy choice — DSE talks about
  // board lots, crypto talks about exchange minimum orders, stablecoins
  // talk about whole tokens. The same component handles all three.
  const kindKey = asset.kind === 'DSE'
    ? 'dse'
    : (asset.kind === 'STABLE' ? 'stable' : 'crypto');

  // For "save N months" / "upgrade tier" we need to pick the most
  // useful next-step. Surplus is the absolute upper bound; if even the
  // full surplus does not buy a lot, "switch to a different asset" is
  // the only honest advice.
  const fullSurplusBuys = plan.lotsAtSurplus;
  const aggressiveBuys  = capacity?.aggressive ? Math.floor(capacity.aggressive / plan.lotCost) : 0;
  const moderateBuys    = capacity?.moderate   ? Math.floor(capacity.moderate   / plan.lotCost) : 0;

  const upgradeTarget = (() => {
    if (currentTierId !== 'aggressive' && aggressiveBuys >= 1) return { id: 'aggressive', cash: capacity.aggressive };
    if (currentTierId !== 'moderate'   && moderateBuys   >= 1) return { id: 'moderate',   cash: capacity.moderate   };
    return null;
  })();

  return (
    <div className={`rounded-xl border p-4 sm:p-5 ${
      meets
        ? 'border-inc/30 bg-inc/5'
        : 'border-dng/30 bg-dng/5'
    }`}>
      <div className={`flex items-center gap-2 mb-3 text-${tone}`}>
        <Icon name={meets ? 'check' : 'alert'} size={16} />
        <span className="text-xs uppercase tracking-ticker font-semibold">
          {t('sim.buy.title')}
        </span>
      </div>

      {/* Top line: budget × price = N units */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4">
        <div className="surface-inset rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-ticker text-txt-3 font-mono">
            {t('sim.buy.budget')}
          </div>
          <div className="mt-1 text-base sm:text-lg font-bold tabular text-txt-1 break-all">
            {fmtTZS(plan.cash)}
          </div>
        </div>
        <div className="surface-inset rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-ticker text-txt-3 font-mono">
            {t('sim.buy.price')}
          </div>
          <div className="mt-1 text-base sm:text-lg font-bold tabular text-txt-1 break-all">
            {fmtTZS(plan.unitPrice)}
            <span className="text-[11px] text-txt-3 font-normal ml-1">
              / {plan.unitLabel.replace(/s$/, '')}
            </span>
          </div>
        </div>
        <div className="surface-inset rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-ticker text-txt-3 font-mono">
            {t('sim.buy.canBuy')}
          </div>
          <div className={`mt-1 text-base sm:text-lg font-bold tabular break-all text-${tone}`}>
            {fmtUnits(plan.units)} <span className="text-xs text-txt-2 font-normal">{plan.unitLabel}</span>
          </div>
        </div>
      </div>

      {meets ? (
        <div className="text-sm text-txt-2 leading-relaxed break-words">
          <span className="font-semibold text-txt-1">
            {t(`sim.buy.${kindKey}.ok.head`)
              .replace('{units}', fmtUnits(plan.units))
              .replace('{symbol}', asset.symbol)}
          </span>{' '}
          {t(`sim.buy.${kindKey}.ok.body`)
            .replace('{cost}', fmtTZS(plan.actualCost))
            .replace('{leftover}', fmtTZS(plan.leftover))
            .replace('{symbol}', asset.symbol)}
          <span className="block mt-2 text-xs text-txt-3">
            {t(`sim.buy.${kindKey}.ok.note`).replace('{lotCost}', fmtTZS(plan.lotCost))}
          </span>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-txt-1 leading-relaxed break-words">
            <span className="font-semibold">
              {t(`sim.buy.${kindKey}.short.head`)
                .replace('{lotQty}', plan.lotQty)
                .replace('{symbol}', asset.symbol)
                .replace('{lotCost}', fmtTZS(plan.lotCost))}
            </span>
            <p className="text-txt-2 mt-1">
              {t(`sim.buy.${kindKey}.short.body`)
                .replace('{shortfall}', fmtTZS(plan.shortfall))
                .replace('{cash}', fmtTZS(plan.cash))
                .replace('{symbol}', asset.symbol)}
            </p>
          </div>

          {/* How to retain enough value to meet the minimum */}
          <div className="rounded-lg border border-bdr/60 bg-surface-3/40 p-3 sm:p-4">
            <div className="text-[10px] uppercase tracking-ticker text-txt-3 font-mono mb-2">
              {t('sim.buy.howTo')}
            </div>
            <ul className="space-y-2 text-sm text-txt-2">
              {/* Option A: save N months at current allocation */}
              {plan.cash > 0 && plan.monthsToAccumulate > 0 && plan.monthsToAccumulate <= 12 && (
                <li className="flex items-start gap-2">
                  <span className="text-accent mt-0.5">•</span>
                  <span className="break-words">
                    {t('sim.buy.fix.save')
                      .replace('{months}', plan.monthsToAccumulate)
                      .replace('{cash}', fmtTZS(plan.cash))
                      .replace('{lotCost}', fmtTZS(plan.lotCost))}
                  </span>
                </li>
              )}

              {/* Option B: upgrade the tier if a higher tier covers a lot */}
              {upgradeTarget && (
                <li className="flex items-start gap-2">
                  <span className="text-accent mt-0.5">•</span>
                  <span className="break-words">
                    {t('sim.buy.fix.upgrade')
                      .replace('{tier}', t(`sim.tier.${upgradeTarget.id}.title`))
                      .replace('{cash}', fmtTZS(upgradeTarget.cash))}
                    {' '}
                    <button
                      type="button"
                      onClick={() => onUpgradeTier?.(upgradeTarget.id)}
                      className="text-accent underline underline-offset-2 hover:text-accent/80"
                    >
                      {t('sim.buy.fix.upgrade.cta')}
                    </button>
                  </span>
                </li>
              )}

              {/* Option C: pick a cheaper alternative — DSE swaps to a
                  cheaper listing, crypto swaps to a stablecoin (which
                  has a fixed ~$1 entry point regardless of the cycle). */}
              {asset.kind === 'DSE' && cheaperSuggestion && (
                <li className="flex items-start gap-2">
                  <span className="text-accent mt-0.5">•</span>
                  <span className="break-words">
                    {t('sim.buy.fix.cheaper')
                      .replace('{cheaperSymbol}', cheaperSuggestion.asset.symbol)
                      .replace('{cheaperLot}', fmtTZS(cheaperSuggestion.lotCost))}
                    {' '}
                    <button
                      type="button"
                      onClick={() => onPickAsset?.(cheaperSuggestion.asset.id)}
                      className="text-accent underline underline-offset-2 hover:text-accent/80"
                    >
                      {t('sim.buy.fix.cheaper.cta').replace('{symbol}', cheaperSuggestion.asset.symbol)}
                    </button>
                  </span>
                </li>
              )}
              {asset.kind === 'CRYPTO' && stableSuggestion && (
                <li className="flex items-start gap-2">
                  <span className="text-accent mt-0.5">•</span>
                  <span className="break-words">
                    {t('sim.buy.fix.stableSwap')
                      .replace('{stableSymbol}', stableSuggestion.asset.symbol)
                      .replace('{stableLot}', fmtTZS(stableSuggestion.lotCost))}
                    {' '}
                    <button
                      type="button"
                      onClick={() => onPickAsset?.(stableSuggestion.asset.id)}
                      className="text-accent underline underline-offset-2 hover:text-accent/80"
                    >
                      {t('sim.buy.fix.stableSwap.cta').replace('{symbol}', stableSuggestion.asset.symbol)}
                    </button>
                  </span>
                </li>
              )}

              {/* Option D: trim spending to free more surplus */}
              <li className="flex items-start gap-2">
                <span className="text-accent mt-0.5">•</span>
                <span className="break-words">
                  {t('sim.buy.fix.trim').replace('{shortfall}', fmtTZS(plan.shortfall))}
                </span>
              </li>

              {/* Option E: only when surplus is so small no plausible plan works */}
              {fullSurplusBuys === 0 && surplus > 0 && (
                <li className="flex items-start gap-2">
                  <span className="text-accent mt-0.5">•</span>
                  <span className="break-words text-txt-3 italic">
                    {t('sim.buy.fix.tooSmall')
                      .replace('{lotCost}', fmtTZS(plan.lotCost))
                      .replace('{surplus}', fmtTZS(surplus))}
                  </span>
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

/* ----------------------------------------------------------------
   AnswerCard — one of the three big result blocks in step 3.
   ---------------------------------------------------------------- */
const AnswerCard = ({ icon, tone, question, headline, body, footer }) => {
  const borders = {
    income:  'border-inc/30',
    expense: 'border-exp/30',
    danger:  'border-dng/30',
    net:     'border-net/30',
    muted:   'border-bdr/60',
  };
  const chips = {
    income:  'bg-inc/10 text-inc',
    expense: 'bg-exp/10 text-exp',
    danger:  'bg-dng/10 text-dng',
    net:     'bg-net/10 text-net',
    muted:   'bg-surface-4/60 text-txt-2',
  };
  const glows = {
    income: 'bg-inc/12', expense: 'bg-exp/12', danger: 'bg-dng/12', net: 'bg-net/12', muted: 'bg-txt-3/5',
  };
  return (
    <div className={`relative glass-pane rounded-2xl border p-4 sm:p-5 overflow-hidden ${borders[tone] || borders.muted}`}>
      <span aria-hidden className={`absolute -right-8 -top-8 w-24 h-24 rounded-full blur-2xl pointer-events-none ${glows[tone] || glows.muted}`} />
      <div className="relative flex items-center gap-2 mb-3">
        <span className={`p-1.5 rounded-lg ${chips[tone] || chips.muted}`}><Icon name={icon} size={14} /></span>
        <span className="text-xs uppercase tracking-ticker font-semibold text-txt-2">{question}</span>
      </div>
      <div className="relative text-base sm:text-lg font-bold text-txt-1 leading-snug mb-2 break-words">
        {headline}
      </div>
      <div className="relative text-sm text-txt-2 leading-relaxed break-words">{body}</div>
      {footer && <div className="relative text-[11px] text-txt-3 mt-3 leading-relaxed break-words">{footer}</div>}
    </div>
  );
};

/* ----------------------------------------------------------------
   ProjectionChart — the "alive" money-growth curve.
   ----------------------------------------------------------------
   Compounds the monthly contribution at the chosen asset's typical
   annual return and plots value vs. cash-in over 60 months, so the
   user literally sees the money the stock's movement could hand back.
   Mirrors the Markets market-cap chart for a consistent premium feel.
   ---------------------------------------------------------------- */
const ProjectionChart = ({ monthly, annual, drawdown, fv12, fv36, fv60, t }) => {
  const th = chartTheme();
  const MONTHS = 60;

  const { series, invested, downside } = useMemo(() => {
    const r = Math.pow(1 + (annual || 0), 1 / 12) - 1;
    const val = [], inv = [], down = [];
    for (let m = 0; m <= MONTHS; m++) {
      const fv = r === 0 ? monthly * m : monthly * ((Math.pow(1 + r, m) - 1) / r);
      val.push(fv);
      inv.push(monthly * m);
      // A single-shock drawdown applied to the accumulated value — the
      // "bad month" floor, so the green upside always has a red shadow.
      down.push(fv * (1 - (drawdown || 0)));
    }
    return { series: val, invested: inv, downside: down };
  }, [monthly, annual, drawdown]);

  const data = {
    labels: series.map((_, i) => i),
    datasets: [
      {
        label: 'Projected value',
        data: series,
        borderColor: th.accent,
        backgroundColor: th.accentFill,
        fill: true, tension: 0.4, borderWidth: 2.4, pointRadius: 0, pointHoverRadius: 4,
        pointHoverBackgroundColor: th.accent,
      },
      {
        label: 'Money you put in',
        data: invested,
        borderColor: th.net,
        backgroundColor: 'transparent',
        fill: false, tension: 0.3, borderWidth: 1.6, borderDash: [5, 5], pointRadius: 0,
      },
      {
        label: 'Bad-month floor',
        data: downside,
        borderColor: th.danger,
        backgroundColor: 'transparent',
        fill: false, tension: 0.4, borderWidth: 1.2, borderDash: [2, 4], pointRadius: 0,
      },
    ],
  };

  const options = {
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: th.tick, font: { size: 10 },
          callback: (v) => (v % 12 === 0 ? `${v / 12}y` : ''),
          maxRotation: 0,
        },
      },
      y: {
        grid: { color: th.grid, drawBorder: false },
        ticks: {
          color: th.tick, font: { size: 10 },
          callback: (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : v),
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: th.tooltipBg, titleColor: th.tooltipTitle, bodyColor: th.tooltipBody,
        borderColor: th.tooltipBorder, borderWidth: 1, padding: 12, cornerRadius: 8,
        callbacks: {
          title: (items) => `Month ${items[0].label}`,
          label: (ctx) => `${ctx.dataset.label}: ${fmtTZS(ctx.parsed.y)}`,
        },
      },
    },
  };

  const legend = [
    { c: th.accent, label: t('sim.proj.value') },
    { c: th.net,    label: t('sim.proj.invested') },
    { c: th.danger, label: t('sim.proj.floor') },
  ];

  return (
    <div className="bento p-4 sm:p-6 relative overflow-hidden mb-5 sm:mb-6">
      <span aria-hidden className="absolute -right-24 -top-24 w-64 h-64 rounded-full blur-3xl bg-accent/10 pointer-events-none" />
      <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
        <div className="min-w-0">
          <Eyebrow>{t('sim.proj.eyebrow')}</Eyebrow>
          <h3 className="mt-2 text-base sm:text-lg font-semibold tracking-tight">{t('sim.proj.title')}</h3>
          <p className="text-xs text-txt-3 mt-1 max-w-md">{t('sim.proj.sub')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {[
            { k: '1y', v: fv12 }, { k: '3y', v: fv36 }, { k: '5y', v: fv60 },
          ].map((p) => (
            <div key={p.k} className="surface-inset rounded-xl px-3 py-2 min-w-[92px]">
              <div className="text-[10px] uppercase tracking-ticker text-txt-3 font-mono">{p.k}</div>
              <div className="text-sm sm:text-base font-bold tabular text-accent break-all">{fmtTZS(p.v)}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="relative">
        <ChartJS type="line" data={data} options={options} height={220} />
      </div>
      <div className="relative flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
        {legend.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5 text-[11px] text-txt-2">
            <span className="w-3 h-[2px] rounded-full" style={{ background: l.c }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
};

/* ----------------------------------------------------------------
   Fallback / deficit screens
   ---------------------------------------------------------------- */
const NoStatementFallback = ({ t }) => (
  <div className="bento p-5 sm:p-6 lg:p-8 border border-accent/20 bg-gradient-to-br from-accent/5 to-transparent">
    <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start">
      <div className="p-3 rounded-xl bg-accent/10 border border-accent/25 flex-shrink-0">
        <Icon name="upload" size={22} className="text-accent" />
      </div>
      <div className="min-w-0 flex-1">
        <Eyebrow>{t('sim.fallback.eyebrow')}</Eyebrow>
        <h3 className="mt-2 text-lg sm:text-xl font-semibold tracking-tight break-words">
          {t('sim.fallback.title')}
        </h3>
        <p className="text-sm text-txt-2 mt-2 leading-relaxed break-words">
          {t('sim.fallback.body')}
        </p>
        <button
          onClick={() => { window.location.hash = '/dashboard'; }}
          className="mt-4 btn-primary px-4 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-2"
        >
          {t('sim.fallback.cta')} <Icon name="arrowRight" size={14} />
        </button>
      </div>
    </div>
  </div>
);

const DeficitFallback = ({ t }) => (
  <div className="bento p-5 sm:p-6 lg:p-8 border border-dng/30 bg-dng/5">
    <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start">
      <div className="p-3 rounded-xl bg-dng/15 text-dng flex-shrink-0">
        <Icon name="alert" size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-lg sm:text-xl font-semibold tracking-tight break-words">
          {t('sim.deficit.title')}
        </h3>
        <p className="text-sm text-txt-2 mt-3 leading-relaxed break-words">
          {t('sim.deficit.body')}
        </p>
        <button
          onClick={() => { window.location.hash = '/dashboard'; }}
          className="mt-4 px-4 py-2.5 rounded-lg text-sm font-medium border border-dng/40 text-dng hover:bg-dng/10 transition inline-flex items-center gap-2"
        >
          {t('sim.deficit.cta')} <Icon name="arrowRight" size={14} />
        </button>
      </div>
    </div>
  </div>
);

/* ----------------------------------------------------------------
   Main component
   ---------------------------------------------------------------- */
const InvestmentSimulator = ({ summary, snapshot }) => {
  const { t } = useT();
  const { flow, capacity } = useMemo(() => investmentCapacity(summary), [summary]);
  const universe = useMemo(() => buildAssetUniverse(snapshot), [snapshot]);
  const recommended = useMemo(() => recommendTier(summary), [summary]);

  const [tierId, setTierId] = useState(() => recommended.id);
  const [categoryId, setCategoryId] = useState('stocks');
  const [assetId, setAssetId] = useState('');
  const [showAllAssets, setShowAllAssets] = useState(false);

  // Re-sync tier picker when the recommendation changes (e.g. user
  // uploaded a new statement).
  useEffect(() => {
    setTierId(recommended.id);
  }, [recommended.id]);

  // Default the chosen asset to the first one in the active category.
  const categoryAssets = useMemo(
    () => assetsInCategory(universe, categoryId),
    [universe, categoryId],
  );
  useEffect(() => {
    if (!categoryAssets.length) {
      setAssetId('');
      return;
    }
    if (!categoryAssets.some((a) => a.id === assetId)) {
      setAssetId(categoryAssets[0].id);
    }
  }, [categoryAssets, assetId]);

  const asset = useMemo(
    () => categoryAssets.find((a) => a.id === assetId) || categoryAssets[0] || null,
    [categoryAssets, assetId],
  );

  const amount = capacity[tierId] || 0;
  // Average monthly fees — pulled from the dashboard's transaction-cost
  // block so the hero chain can break down "money out" into the part
  // that's bank/wallet charges vs the rest.
  const fees = useMemo(() => {
    const tc = summary?.transaction_costs || {};
    const total = Number(tc.estimated_total) || 0;
    const periods = Math.max(1, flow.periods || 1);
    return total / periods;
  }, [summary, flow.periods]);
  const tierPct = Math.round(
    (CAPACITY_TIERS.find((tt) => tt.id === tierId)?.pct || 0) * 100,
  );
  const tierLabel = t(`sim.tier.${tierId}.title`);

  const sim = useMemo(
    () => simulateInvestment({ summary, asset, monthly: amount }),
    [summary, asset, amount],
  );

  // The buy plan grounds the abstract "TZS amount" in a concrete share
  // count for the chosen asset — the question users actually have when
  // they pick CRDB or NMB from the chip grid.
  const buyPlan = useMemo(
    () => computeBuyPlan(asset, amount, Math.max(0, flow.monthlySurplus)),
    [asset, amount, flow.monthlySurplus],
  );

  // When the chosen DSE asset's lot is too rich for the current
  // allocation, surface the cheapest DSE listing that *does* fit.
  const cheaperSuggestion = useMemo(
    () => (buyPlan && !buyPlan.meetsMinimum ? suggestCheaperDseAsset(universe, asset, amount) : null),
    [universe, asset, amount, buyPlan],
  );

  // For crypto, the practical "cheaper" alternative is a stablecoin —
  // 1 USDT ≈ 2,500 TZS regardless of where BTC is in its cycle, so the
  // entry barrier is the lowest of any digital asset.
  const stableSuggestion = useMemo(() => {
    if (!buyPlan || buyPlan.meetsMinimum || asset?.kind !== 'CRYPTO') return null;
    const stable = universe.find((a) => a.kind === 'STABLE' && a.price > 0);
    if (!stable) return null;
    return { asset: stable, lotCost: stable.price };
  }, [universe, asset, buyPlan]);

  // Verdict — combines lifestyle impact with the asset's risk profile
  // into a single, plain-language go / caution / stop tag.
  const verdict = useMemo(() => {
    if (sim.status === 'unsafe') return { tag: 'stop',    tone: 'danger'  };
    if (sim.status === 'tight')  return { tag: 'caution', tone: 'expense' };
    if (sim.profile.risk === 'Extreme') return { tag: 'caution', tone: 'expense' };
    if (sim.status === 'invisible' || sim.status === 'balanced') {
      return { tag: 'go', tone: 'income' };
    }
    return { tag: 'caution', tone: 'expense' };
  }, [sim]);

  /* ----------- Early returns ----------- */
  if (!summary || !summary.upload_count) {
    return <NoStatementFallback t={t} />;
  }
  const surplus = Math.max(0, flow.monthlySurplus);
  if (surplus <= 0) {
    return <DeficitFallback t={t} />;
  }

  /* ----------- Step 3 copy interpolation ----------- */
  const q1 = (() => {
    if (sim.amount === 0) {
      return { headline: '—', body: t('sim.q1.detail.idle'), tone: 'muted', icon: 'arrowRight' };
    }
    if (sim.status === 'unsafe') {
      return {
        headline: t('sim.q1.unsafe'),
        body: t('sim.q1.detail.unsafe').replace('{gap}', fmtTZS(Math.abs(sim.buffer))),
        tone: 'danger', icon: 'alert',
      };
    }
    if (sim.status === 'tight') {
      return {
        headline: t('sim.q1.tight'),
        body: t('sim.q1.detail.tight').replace('{buffer}', fmtTZS(sim.buffer)),
        tone: 'expense', icon: 'alert',
      };
    }
    return {
      headline: t('sim.q1.ok'),
      body: t('sim.q1.detail.ok').replace('{buffer}', fmtTZS(sim.buffer)),
      tone: 'income', icon: 'check',
    };
  })();

  const q2Detail = t('sim.q2.detail')
    .replace('{asset}', asset?.symbol || asset?.name || '')
    .replace('{rate}', `${(sim.profile.annual * 100).toFixed(0)}%`);

  const q3Detail = t('sim.q3.detail')
    .replace('{invested}', fmtTZS(sim.fv12))
    .replace('{downside}', fmtTZS(sim.downside12));

  return (
    <div className="space-y-5 sm:space-y-7">
      {/* ---- Hero ---- */}
      <HeroBlock
        flow={flow}
        fees={fees}
        headline={amount || capacity.moderate}
        tierPct={tierPct}
        tierLabel={tierLabel}
        t={t}
      />

      {/* ---- Step 1: Amount ---- */}
      <StepCard
        stepEyebrow={t('sim.step1.eyebrow')}
        title={t('sim.step1.title')}
        lede={t('sim.step1.lede')}
      >
        <div className="rounded-xl border border-accent/25 bg-accent/5 p-3 sm:p-4 mb-5 flex items-start gap-3">
          <div className="p-1.5 rounded-md bg-accent/15 text-accent flex-shrink-0">
            <Icon name="sparkles" size={14} />
          </div>
          <p className="text-xs sm:text-sm text-txt-1 leading-relaxed break-words">
            <span className="font-semibold">{t('sim.step1.recommend')}:</span>{' '}
            {t(`sim.tier.${recommended.id}.title`)} — <AutoT>{t(recommended.reasonKey)}</AutoT>{' '}
            <span className="text-txt-3">{t('sim.step1.recommend.tail')}</span>
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {CAPACITY_TIERS.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              value={capacity[tier.id]}
              active={tier.id === tierId}
              recommended={tier.id === recommended.id}
              onPick={() => setTierId(tier.id)}
              t={t}
            />
          ))}
        </div>
      </StepCard>

      {/* ---- Step 2: Where ---- */}
      <StepCard
        stepEyebrow={t('sim.step2.eyebrow')}
        title={t('sim.step2.title')}
        lede={t('sim.step2.lede')}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-5 sm:mb-6">
          {ASSET_CATEGORIES.map((cat) => {
            // Use the first matching asset's profile for the typical-return
            // / typical-risk numbers shown on the card.
            const sample = universe.find((a) => cat.kinds.includes(a.kind));
            const profile = sample?.profile || { annual: 0, drawdown: 0 };
            return (
              <CategoryCard
                key={cat.id}
                category={cat}
                profile={profile}
                active={cat.id === categoryId}
                onPick={setCategoryId}
                t={t}
              />
            );
          })}
        </div>

        <div className="surface-inset rounded-xl p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-2 mb-3 flex-wrap">
            <span className="text-xs uppercase tracking-ticker text-txt-3 font-mono">
              {t('sim.cat.pickAsset')}
            </span>
            {categoryAssets.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllAssets((v) => !v)}
                className="text-xs text-accent hover:underline"
              >
                {showAllAssets ? t('sim.cat.showLess') : t('sim.cat.showAll')}
              </button>
            )}
          </div>
          {categoryAssets.length === 0 ? (
            <p className="text-sm text-txt-3 py-3">{t('sim.cat.empty')}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
              {(showAllAssets ? categoryAssets : categoryAssets.slice(0, 6)).map((a) => (
                <AssetChip key={a.id} asset={a} active={a.id === assetId} onPick={setAssetId} />
              ))}
            </div>
          )}
          {asset && (
            <div className="mt-4 pt-4 border-t border-bdr/60 flex flex-wrap items-center gap-2 text-xs text-txt-3">
              <span className="font-mono font-semibold text-txt-1">{asset.symbol}</span>
              <span className="text-txt-2">{asset.name}</span>
              <Badge color={RISK_BADGE[asset.profile.risk]}>
                {t(`sim.risk.${asset.profile.risk}`)} {t('sim.risk.suffix')}
              </Badge>
            </div>
          )}
        </div>

        {asset && buyPlan && (
          <div className="mt-4 sm:mt-5">
            <BuyBreakdown
              plan={buyPlan}
              asset={asset}
              surplus={Math.max(0, flow.monthlySurplus)}
              capacity={capacity}
              currentTierId={tierId}
              onUpgradeTier={setTierId}
              onPickAsset={setAssetId}
              cheaperSuggestion={cheaperSuggestion}
              stableSuggestion={stableSuggestion}
              t={t}
            />
          </div>
        )}
      </StepCard>

      {/* ---- Step 3: What happens ---- */}
      <StepCard
        stepEyebrow={t('sim.step3.eyebrow')}
        title={t('sim.step3.title')}
        lede={t('sim.step3.lede')}
      >
        {/* Alive projection — the money-growth curve for the picked asset */}
        {amount > 0 && (
          <ProjectionChart
            monthly={amount}
            annual={sim.profile.annual}
            drawdown={sim.profile.drawdown}
            fv12={sim.fv12}
            fv36={sim.fv36}
            fv60={sim.fv60}
            t={t}
          />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 mb-5 sm:mb-6">
          <AnswerCard
            icon={q1.icon}
            tone={q1.tone}
            question={t('sim.q1.title')}
            headline={q1.headline}
            body={<AutoT>{q1.body}</AutoT>}
          />
          <AnswerCard
            icon="trending"
            tone="net"
            question={t('sim.q2.title')}
            headline={fmtTZS(sim.fv12)}
            body={
              <div className="space-y-2">
                <div><AutoT>{q2Detail}</AutoT></div>
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-txt-3 text-xs">{t('sim.q2.in12')}</span>
                    <span className="font-bold tabular text-txt-1">{fmtTZS(sim.fv12)}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-txt-3 text-xs">{t('sim.q2.in36')}</span>
                    <span className="font-bold tabular text-txt-1">{fmtTZS(sim.fv36)}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-txt-3 text-xs">{t('sim.q2.in60')}</span>
                    <span className="font-bold tabular text-txt-1">{fmtTZS(sim.fv60)}</span>
                  </div>
                </div>
              </div>
            }
            footer={t('sim.q2.note')}
          />
          <AnswerCard
            icon="alert"
            tone={sim.profile.risk === 'Extreme' || sim.profile.risk === 'High' ? 'expense' : 'muted'}
            question={t('sim.q3.title')}
            headline={fmtTZS(sim.downside12)}
            body={<AutoT>{q3Detail}</AutoT>}
            footer={
              <>
                <span className="font-semibold text-txt-2">{t('sim.q3.basis')} </span>
                <AutoT>{sim.profile.basis}</AutoT>
              </>
            }
          />
        </div>

        {/* Verdict */}
        <div className={`rounded-2xl border p-4 sm:p-5 flex flex-col sm:flex-row gap-3 sm:gap-5 sm:items-center
          ${verdict.tone === 'income' ? 'border-inc/30 bg-inc/5' :
            verdict.tone === 'expense' ? 'border-exp/30 bg-exp/5' :
            'border-dng/30 bg-dng/5'}`}>
          <div className={`p-2.5 rounded-xl flex-shrink-0
            ${verdict.tone === 'income' ? 'bg-inc/15 text-inc' :
              verdict.tone === 'expense' ? 'bg-exp/15 text-exp' :
              'bg-dng/15 text-dng'}`}>
            <Icon name={verdict.tone === 'income' ? 'check' : 'alert'} size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-ticker text-txt-3 font-mono mb-1">
              {t('sim.verdict.title')}
            </div>
            <div className="text-base sm:text-lg font-bold text-txt-1 mb-1 break-words">
              {t(`sim.verdict.tag.${verdict.tag}`)}
            </div>
            <p className="text-sm text-txt-2 leading-relaxed break-words">
              <AutoT>{sim.recommendation}</AutoT>
            </p>
          </div>
        </div>
      </StepCard>

      <p className="text-[11px] text-txt-3 leading-relaxed text-center max-w-3xl mx-auto px-2">
        {t('sim.disclaimer')}
      </p>
    </div>
  );
};

export default InvestmentSimulator;
