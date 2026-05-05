import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../components/navigation';
import { Icon } from '../components/Icon';
import { Badge, Eyebrow } from '../components/common';
import { useT, AutoT } from '../data/i18n';
import { askMarketInsight, fetchDashboardSummary, fetchMarketSnapshot } from '../data/api';
import InvestmentSimulator from '../components/InvestmentSimulator';

/* ----------------------------------------------------------------
   Markets — live data view backed by the PesaLens market bot.

   Tanzanian feeds (DSE / BOT / EWURA) plus international references
   (crypto, equity indices, Polymarket) are pulled from the backend
   cache, which the scheduler refreshes on its own cadence. The page
   itself never scrapes anything live — it just reads the cache.
   ---------------------------------------------------------------- */

const STRATEGIES = [
  { title: 'Low-Risk Preservation', desc: 'Capital preservation via fixed deposits, government bonds, and money-market funds. Suits conservative profiles.', risk: 'Low',    color: 'inc', icon: 'shield' },
  { title: 'Balanced Growth',       desc: 'Mix of fixed income and equities for steady growth with moderate risk. Suits medium-term goals.',                     risk: 'Medium', color: 'exp', icon: 'chart' },
  { title: 'Aggressive Growth',     desc: 'Equity-heavy portfolio targeting high returns. Best for long time horizons.',                                          risk: 'High',   color: 'dng', icon: 'trending' },
  { title: 'Emergency Fund First',  desc: 'Build 3–6 months of expenses in liquid savings before investing.',                                                     risk: 'Low',    color: 'inc', icon: 'wallet' },
  { title: '50 / 30 / 20 Allocation', desc: 'Divide income across needs, wants and savings — a starter framework for cash-flow management.',                       risk: 'Low',    color: 'net', icon: 'zap' },
];

const INSURANCE = [
  { name: 'Jubilee Insurance',   type: 'Life & Health',   desc: 'Comprehensive life and health insurance products for individuals and families.' },
  { name: 'AAR Insurance',       type: 'Health',          desc: 'Leading health insurance provider with extensive hospital networks across Tanzania.' },
  { name: 'UAP Insurance',       type: 'General',         desc: 'Property, motor, and business insurance solutions for individuals and enterprises.' },
  { name: 'MetLife Tanzania',    type: 'Life & Savings',  desc: 'Life insurance and long-term savings plans with flexible premium structures.' },
];

// Quick-ask keys; the actual labels come from t(...) at render time so
// they switch instantly when the user toggles language.
const QUICK_ASK_KEYS = ['mki.quick.1', 'mki.quick.2', 'mki.quick.3', 'mki.quick.4', 'mki.quick.5'];

// The backend returns this exact phrase in its offline fallback. We
// detect it client-side so the chat surface can show a status banner
// instead of treating the fallback like a normal AI reply.
const OFFLINE_MARKER = 'PesaLens AI advisor is offline';

const fmt = (v, decimals = 2) => {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const fmtCompact = (v) => {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return n.toLocaleString('en-US');
};

const fmtAge = (iso) => {
  if (!iso) return 'never';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const Delta = ({ pct }) => {
  if (pct == null || Number.isNaN(Number(pct))) return <span className="text-txt-3">—</span>;
  const n = Number(pct);
  const up = n >= 0;
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[11px] tabular ${up ? 'text-inc' : 'text-dng'}`}>
      <Icon name={up ? 'arrowUpRight' : 'arrowDownRight'} size={11} />
      {up ? '+' : ''}{n.toFixed(2)}%
    </span>
  );
};

const Section = ({ num, title, sub, action, children }) => (
  <div className="card-soft p-3 sm:p-5 lg:p-6">
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3 mb-4">
      <div className="min-w-0 flex-1">
        <Eyebrow num={num}>{title}</Eyebrow>
        {sub && <p className="text-[11px] sm:text-xs text-txt-3 mt-1.5 font-mono uppercase tracking-ticker break-words">{sub}</p>}
      </div>
      {action && <div className="flex-shrink-0 self-start">{action}</div>}
    </div>
    {children}
  </div>
);

/* ----------------------------------------------------------------
   AI insight panel — chat with the market advisor agent.
   ---------------------------------------------------------------- */
const InsightPanel = ({ snapshot }) => {
  const { t } = useT();
  const [history, setHistory] = useState([]);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [lastAttempt, setLastAttempt] = useState('');
  const scrollerRef = useRef(null);

  // Map a thrown request error to a precise human-readable reason.
  // The generic "Could not reach the advisor" was masking three very
  // different failure modes (network, auth, plan) — and the user
  // couldn't tell which one they were hitting.
  const errorMessage = (err) => {
    if (!err) return t('mki.error.generic');
    if (err.status === 0)   return t('mki.error.network');
    if (err.status === 401) return t('mki.error.unauth');
    if (err.status === 402) return t('mki.error.plan');
    return err.message || t('mki.error.generic');
  };

  const send = async (raw) => {
    const message = (raw ?? draft).trim();
    if (!message || pending) return;
    setError('');
    setDraft('');
    setLastAttempt(message);
    const next = [...history, { role: 'user', text: message }];
    setHistory(next);
    setPending(true);
    try {
      const { reply } = await askMarketInsight(message, history);
      const isOffline = typeof reply === 'string' && reply.includes(OFFLINE_MARKER);
      setOffline(isOffline);
      // When offline, the backend's fallback message starts with raw
      // ticker data — not a useful chat reply. We render the banner
      // instead and skip the bubble, so the conversation stays clean.
      if (!isOffline) {
        setHistory((h) => [...h, { role: 'assistant', text: reply || t('mki.error.generic') }]);
      } else {
        // Drop the just-pushed user bubble too — restoring the empty
        // state until the operator sets an API key. Keeping the
        // ghost-user message there made it look like the AI had
        // failed silently.
        setHistory([]);
      }
    } catch (err) {
      setError(errorMessage(err));
      setHistory((h) => [...h, { role: 'assistant', text: errorMessage(err) }]);
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [history, pending]);

  const dseCount   = snapshot?.dse?.data?.length || 0;
  const fxCount    = snapshot?.forex_bot?.data?.length || 0;
  const cryptoCount = snapshot?.crypto?.data?.length || 0;
  const headingTpl = t('mki.heading');
  const heading    = headingTpl
    .replace('{dse}', dseCount)
    .replace('{fx}', fxCount)
    .replace('{coins}', cryptoCount);

  return (
    <div className="card-soft p-4 sm:p-5 lg:p-6 border border-accent/15 bg-gradient-to-br from-accent/5 to-transparent">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <Eyebrow num="03">{t('mki.eyebrow')}</Eyebrow>
          <h3 className="mt-2 text-sm sm:text-base font-semibold tracking-tight break-words">
            {heading}
          </h3>
          <p className="text-xs text-txt-3 mt-1">{t('mki.sub')}</p>
        </div>
        <Badge color="accent" dot className="self-start flex-shrink-0">{t('mki.badge')}</Badge>
      </div>

      {offline && (
        <div className="mb-4 rounded-xl border border-exp/30 bg-exp/5 p-3 sm:p-4">
          <div className="flex items-start gap-3">
            <div className="p-1.5 rounded-md bg-exp/15 text-exp flex-shrink-0">
              <Icon name="alert" size={14} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-txt-1 mb-1">{t('mki.offline.title')}</div>
              <p className="text-xs sm:text-sm text-txt-2 leading-relaxed break-words">
                {t('mki.offline.body')}
              </p>
            </div>
          </div>
        </div>
      )}

      <div ref={scrollerRef} className="space-y-3 max-h-72 overflow-y-auto pr-1 mb-3">
        {history.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-xs text-txt-3 mb-3">{t('mki.try')}</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {QUICK_ASK_KEYS.map((key) => (
                <button
                  key={key}
                  onClick={() => send(t(key))}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg border border-bdr hover:border-accent/40 hover:bg-accent/5 text-txt-2 transition"
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          history.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[90%] px-3 py-2 rounded-xl text-xs sm:text-sm leading-relaxed break-words whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-accent text-white rounded-br-sm'
                    : 'bg-surface-4/70 text-txt-1 border border-bdr/60 rounded-bl-sm'
                }`}
              >
                {/* AI replies arrive in English from the backend; AutoT
                    routes them through the translator chain when the
                    UI language is Swahili. User messages render
                    verbatim — they typed them. */}
                {m.role === 'assistant' ? <AutoT>{m.text}</AutoT> : m.text}
              </div>
            </div>
          ))
        )}
        {pending && (
          <div className="flex justify-start">
            <div className="bg-surface-4/70 border border-bdr/60 px-3 py-2 rounded-xl rounded-bl-sm text-sm text-txt-2">
              <span className="inline-flex gap-1 items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse [animation-delay:0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse [animation-delay:0.3s]" />
              </span>
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="flex gap-2 items-center"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={pending}
          placeholder={t('mki.placeholder')}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-surface-4/60 border border-bdr/60 focus:border-accent/40 outline-none text-sm placeholder:text-txt-3"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className="px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-50 hover:bg-accent/90 transition flex items-center gap-1.5 flex-shrink-0"
          aria-label={t('mki.ask')}
        >
          <Icon name="send" size={14} />
          <span className="hidden sm:inline">{t('mki.ask')}</span>
        </button>
      </form>
      {error && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <p className="text-xs text-dng">{error}</p>
          {lastAttempt && (
            <button
              type="button"
              onClick={() => send(lastAttempt)}
              className="text-[11px] px-2 py-1 rounded-md border border-dng/30 text-dng hover:bg-dng/10 transition"
            >
              {t('mki.retry')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/* ----------------------------------------------------------------
   Data panels
   ---------------------------------------------------------------- */
const DSE_FILTERS = [
  { id: 'volume',  label: 'Most Active', hint: 'Highest trading volume' },
  { id: 'price',   label: 'Top Price',   hint: 'Most expensive shares' },
  { id: 'gainers', label: 'Top Gainers', hint: 'Biggest % rise' },
  { id: 'losers',  label: 'Top Losers',  hint: 'Biggest % drop' },
  { id: 'movers',  label: 'Big Movers',  hint: 'Largest move either way' },
];

const DSEPanel = ({ payload }) => {
  const rows = payload?.data || [];
  const [filter, setFilter] = useState('volume');

  const sorted = useMemo(() => {
    const list = [...rows];
    switch (filter) {
      case 'price':
        return list.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
      case 'gainers':
        return list.sort((a, b) => (Number(b.change_pct) || 0) - (Number(a.change_pct) || 0));
      case 'losers':
        return list.sort((a, b) => (Number(a.change_pct) || 0) - (Number(b.change_pct) || 0));
      case 'movers':
        return list.sort((a, b) => Math.abs(b.change_pct || 0) - Math.abs(a.change_pct || 0));
      case 'volume':
      default:
        return list.sort((a, b) => (Number(b.volume) || 0) - (Number(a.volume) || 0));
    }
  }, [rows, filter]);

  if (!rows.length) return <EmptyPanel label="DSE feed has no data yet — the bot will retry." />;

  const visible = sorted.slice(0, 12);
  const leader = visible[0];
  const activeFilter = DSE_FILTERS.find((f) => f.id === filter);
  const volumeAsOf = visible.find((s) => s.volume_as_of)?.volume_as_of;

  const leaderMetric = (() => {
    if (!leader) return null;
    switch (filter) {
      case 'price':   return { label: 'Price', value: `TZS ${fmt(leader.price)}` };
      case 'gainers':
      case 'losers':
      case 'movers':  return { label: 'Change', value: `${(Number(leader.change_pct) || 0).toFixed(2)}%` };
      case 'volume':
      default:        return { label: 'Volume', value: fmtCompact(leader.volume) };
    }
  })();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {DSE_FILTERS.map((f) => {
          const active = f.id === filter;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              title={f.hint}
              className={`text-[11px] sm:text-xs px-2.5 py-1.5 rounded-lg border transition ${
                active
                  ? 'border-accent/50 bg-accent/10 text-txt-1 font-medium'
                  : 'border-bdr/60 text-txt-2 hover:border-accent/30 hover:bg-accent/5'
              }`}
            >
              {f.label}
            </button>
          );
        })}
        {volumeAsOf && (filter === 'volume' || filter === 'price') && (
          <span className="ml-auto text-[10px] sm:text-[11px] text-txt-3 font-mono uppercase tracking-ticker">
            Vol as of {volumeAsOf}
          </span>
        )}
      </div>

      {leader && leaderMetric && (
        <div className="rounded-xl border border-accent/25 bg-gradient-to-br from-accent/10 to-transparent p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-[10px] sm:text-[11px] uppercase tracking-ticker text-txt-3">
                {activeFilter?.label} · Leader
              </div>
              <div className="mt-1 flex items-baseline gap-2 flex-wrap">
                <span className="font-mono text-base sm:text-lg font-semibold">{leader.symbol}</span>
                <span className="text-xs sm:text-sm text-txt-2 truncate">{leader.name}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-ticker text-txt-3">{leaderMetric.label}</div>
              <div className="font-mono text-base sm:text-lg tabular font-semibold">{leaderMetric.value}</div>
            </div>
          </div>
        </div>
      )}

      <div className="border border-bdr/60 rounded-xl overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead className="bg-surface-4/60 text-[10px] sm:text-[11px] uppercase tracking-ticker text-txt-3">
            <tr>
              <th className="text-left px-2 sm:px-3 py-2">#</th>
              <th className="text-left px-2 sm:px-3 py-2">Sym</th>
              <th className="text-left px-2 sm:px-3 py-2 hidden md:table-cell">Company</th>
              <th className="text-right px-2 sm:px-3 py-2">Price</th>
              <th className="text-right px-2 sm:px-3 py-2">Δ %</th>
              <th className="text-right px-2 sm:px-3 py-2">Vol</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s, i) => {
              const highlightCol = filter === 'price' ? 'price' : (filter === 'volume' ? 'volume' : 'change');
              return (
                <tr key={s.symbol} className="border-t border-bdr/40 hover:bg-surface-4/30">
                  <td className="px-2 sm:px-3 py-2 text-txt-3 tabular">{i + 1}</td>
                  <td className="px-2 sm:px-3 py-2 font-mono font-medium whitespace-nowrap">{s.symbol}</td>
                  <td className="px-2 sm:px-3 py-2 text-txt-2 hidden md:table-cell truncate max-w-[200px]">{s.name}</td>
                  <td className={`px-2 sm:px-3 py-2 text-right tabular whitespace-nowrap ${highlightCol === 'price' ? 'text-txt-1 font-semibold' : ''}`}>{fmt(s.price)}</td>
                  <td className={`px-2 sm:px-3 py-2 text-right whitespace-nowrap ${highlightCol === 'change' ? 'font-semibold' : ''}`}><Delta pct={s.change_pct} /></td>
                  <td className={`px-2 sm:px-3 py-2 text-right tabular whitespace-nowrap ${highlightCol === 'volume' ? 'text-txt-1 font-semibold' : 'text-txt-2'}`}>{fmtCompact(s.volume)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ForexPanel = ({ bot, global: globalFx }) => {
  const botRates = bot?.data || [];
  const globalRates = globalFx?.data || [];
  if (!botRates.length && !globalRates.length) {
    return <EmptyPanel label="Bank of Tanzania scrape returned no rates yet." />;
  }

  const sortedBot = [...botRates].sort(
    (a, b) => (Number(b.selling) || Number(b.buying) || 0) - (Number(a.selling) || Number(a.buying) || 0)
  );
  const leader = sortedBot[0];
  const leaderRate = leader ? (Number(leader.selling) || Number(leader.buying) || 0) : 0;

  return (
    <div className="space-y-4">
      {leader && leaderRate > 0 && (
        <div className="rounded-xl border border-net/25 bg-gradient-to-br from-net/10 to-transparent p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-[10px] sm:text-[11px] uppercase tracking-ticker text-txt-3">
                Strongest vs TZS
              </div>
              <div className="mt-1 text-base sm:text-xl font-semibold tabular break-words">
                1 {leader.currency} = <span className="text-net">{fmt(leaderRate, 0)}</span> TZS
              </div>
              <div className="text-[11px] sm:text-xs text-txt-3 mt-0.5">
                Highest TZS value among Bank of Tanzania indicative rates.
              </div>
            </div>
            <Badge color="net" dot className="self-start flex-shrink-0">Leader</Badge>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="min-w-0">
          <h4 className="text-[11px] sm:text-xs uppercase tracking-ticker text-txt-3 mb-2 break-words">Bank of Tanzania · 1 unit = TZS (sorted strongest first)</h4>
          <div className="border border-bdr/60 rounded-xl overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-surface-4/60 text-[10px] sm:text-[11px] uppercase tracking-ticker text-txt-3">
                <tr>
                  <th className="text-left px-2 sm:px-3 py-2">Currency</th>
                  <th className="text-right px-2 sm:px-3 py-2">Buy</th>
                  <th className="text-right px-2 sm:px-3 py-2">Sell</th>
                </tr>
              </thead>
              <tbody>
                {sortedBot.length === 0 && (
                  <tr><td colSpan="3" className="px-3 py-3 text-center text-xs text-txt-3">No rates cached yet.</td></tr>
                )}
                {sortedBot.map((r, i) => (
                  <tr key={r.currency} className={`border-t border-bdr/40 ${i === 0 ? 'bg-net/5' : ''}`}>
                    <td className="px-2 sm:px-3 py-2 font-mono font-medium whitespace-nowrap">
                      {i === 0 && <span className="text-net mr-1">★</span>}{r.currency}
                    </td>
                    <td className="px-2 sm:px-3 py-2 text-right tabular whitespace-nowrap">{fmt(r.buying)}</td>
                    <td className={`px-2 sm:px-3 py-2 text-right tabular whitespace-nowrap ${i === 0 ? 'font-semibold text-txt-1' : ''}`}>{fmt(r.selling)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="min-w-0">
          <h4 className="text-[11px] sm:text-xs uppercase tracking-ticker text-txt-3 mb-2 break-words">Global cross-check (USD base · ECB)</h4>
          <div className="border border-bdr/60 rounded-xl overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-surface-4/60 text-[10px] sm:text-[11px] uppercase tracking-ticker text-txt-3">
                <tr>
                  <th className="text-left px-2 sm:px-3 py-2">Currency</th>
                  <th className="text-right px-2 sm:px-3 py-2">USD →</th>
                </tr>
              </thead>
              <tbody>
                {globalRates.map((r) => (
                  <tr key={r.currency} className="border-t border-bdr/40">
                    <td className="px-2 sm:px-3 py-2 font-mono font-medium whitespace-nowrap">{r.currency}</td>
                    <td className="px-2 sm:px-3 py-2 text-right tabular whitespace-nowrap">{fmt(r.rate_usd, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

const FuelPanel = ({ payload }) => {
  const data = payload?.data || {};
  const hasPrices = data.petrol || data.diesel || data.kerosene;
  if (!hasPrices) {
    return <EmptyPanel label={data.error ? `EWURA scrape: ${data.error}` : 'Latest EWURA cap-price PDF not parsed yet.'} />;
  }
  const items = [
    { label: 'Petrol',   value: data.petrol,   icon: 'zap',     color: 'exp' },
    { label: 'Diesel',   value: data.diesel,   icon: 'chart',   color: 'net' },
    { label: 'Kerosene', value: data.kerosene, icon: 'sparkles',color: 'dng' },
  ];
  return (
    <div>
      <p className="text-[11px] sm:text-xs text-txt-3 mb-3">Cap prices for {data.region || 'Dar es Salaam'} · TZS per litre</p>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {items.map((it) => (
          <div key={it.label} className="bg-surface-4/50 border border-bdr/50 rounded-xl p-3 sm:p-4 min-w-0">
            <div className="flex items-center justify-between mb-2 gap-1">
              <span className="text-[10px] sm:text-[11px] uppercase tracking-ticker text-txt-3 truncate">{it.label}</span>
              <Icon name={it.icon} size={14} className="text-txt-3 flex-shrink-0" />
            </div>
            <div className="text-base sm:text-2xl font-semibold tabular truncate">
              {it.value ? fmt(it.value, 0) : '—'}
              <span className="text-[10px] sm:text-xs text-txt-3 ml-1">TZS/L</span>
            </div>
          </div>
        ))}
      </div>
      {data.pdf_url && (
        <a href={data.pdf_url} target="_blank" rel="noopener noreferrer"
           className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-accent hover:underline">
          <Icon name="arrowUpRight" size={11} /> Source PDF (EWURA)
        </a>
      )}
    </div>
  );
};

const CryptoPanel = ({ payload }) => {
  const rows = payload?.data || [];
  if (!rows.length) return <EmptyPanel label="Crypto feed warming up." />;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
      {rows.map((c) => (
        <div key={c.symbol} className="bg-surface-4/50 border border-bdr/50 rounded-xl p-3 sm:p-4 card-hover min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="min-w-0">
              <div className="font-mono font-semibold text-sm truncate">{c.symbol}</div>
              <div className="text-[10px] sm:text-[11px] text-txt-3 capitalize truncate">{c.name}</div>
            </div>
            <div className="flex-shrink-0"><Delta pct={c.change_pct} /></div>
          </div>
          <div className="text-base sm:text-lg font-semibold tabular truncate">${fmt(c.price_usd)}</div>
          <div className="text-[10px] sm:text-[11px] text-txt-3 tabular truncate">≈ TZS {fmtCompact(c.price_tzs)}</div>
        </div>
      ))}
    </div>
  );
};

const IndicesPanel = ({ payload }) => {
  const rows = payload?.data || [];
  if (!rows.length) return <EmptyPanel label="Equity indices feed warming up." />;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {rows.map((i) => (
        <div key={i.symbol} className="bg-surface-4/50 border border-bdr/50 rounded-xl p-3 sm:p-4 min-w-0">
          <div className="text-[11px] uppercase tracking-ticker text-txt-3 mb-1 truncate">{i.symbol}</div>
          <div className="font-semibold text-sm truncate">{i.name}</div>
          <div className="mt-2 text-base sm:text-lg tabular truncate">
            {fmt(i.price, 2)} <span className="text-[11px] text-txt-3">{i.currency}</span>
          </div>
          <div className="mt-1"><Delta pct={i.change_pct} /></div>
        </div>
      ))}
    </div>
  );
};

const PredictionsPanel = ({ payload }) => {
  const rows = payload?.data || [];
  if (!rows.length) return <EmptyPanel label="Polymarket feed warming up." />;
  return (
    <div className="space-y-2">
      {rows.slice(0, 6).map((m, i) => {
        const yes = Number(m.yes_pct) || 0;
        return (
          <div key={i} className="bg-surface-4/50 border border-bdr/50 rounded-xl p-3">
            <div className="flex items-start justify-between gap-2 sm:gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <div className="text-xs sm:text-sm font-medium break-words leading-snug">{m.question}</div>
                <div className="text-[10px] sm:text-[11px] text-txt-3 mt-0.5 truncate">
                  {m.category} · vol {fmtCompact(m.volume)}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono text-base sm:text-lg tabular">{yes.toFixed(0)}%</div>
                <div className="text-[10px] text-txt-3 uppercase tracking-ticker">YES</div>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${Math.min(100, yes)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const EmptyPanel = ({ label }) => (
  <div className="border border-dashed border-bdr/60 rounded-xl p-6 text-center text-xs text-txt-3">
    {label}
  </div>
);

/* ----------------------------------------------------------------
   Page
   ---------------------------------------------------------------- */
const MarketsPage = () => {
  const { t } = useT();
  const [snapshot, setSnapshot] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setError('');
      const [snap, sum] = await Promise.all([
        fetchMarketSnapshot(),
        // Personal context for the simulator. A failure here shouldn't
        // break the page — the simulator falls back to an "upload first"
        // CTA when no summary is available.
        fetchDashboardSummary().catch(() => null),
      ]);
      setSnapshot(snap);
      setSummary(sum);
    } catch (err) {
      setError(err.message || 'Unable to load market data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1000); // pull cache every 5 minutes
    return () => clearInterval(id);
  }, []);

  const ages = useMemo(() => ({
    dse:        fmtAge(snapshot?.dse?.updated_at),
    bot:        fmtAge(snapshot?.forex_bot?.updated_at),
    fuel:       fmtAge(snapshot?.fuel?.updated_at),
    crypto:     fmtAge(snapshot?.crypto?.updated_at),
    indices:    fmtAge(snapshot?.indices?.updated_at),
    predictions:fmtAge(snapshot?.predictions?.updated_at),
  }), [snapshot]);

  return (
    <AppShell>
      <div className="space-y-5 sm:space-y-7">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <Eyebrow num="00">{t('mk.eyebrow')}</Eyebrow>
            <h1 className="mt-2 text-xl sm:text-2xl lg:text-3xl font-semibold tracking-tight break-words">{t('mk.title')}</h1>
            <p className="text-xs sm:text-sm text-txt-2 mt-1.5 max-w-xl leading-relaxed">
              Your money, mapped onto the market. The simulator below tells you how much you can safely allocate — the panels under it are the raw context.
            </p>
            <p className="text-[10px] sm:text-xs text-txt-3 mt-2 font-mono uppercase tracking-ticker break-words">
              DSE · BOT · EWURA · CRYPTO · S&P · POLYMARKET
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-bdr hover:border-accent/40 text-xs text-txt-2 hover:text-txt-1 transition disabled:opacity-50 flex-shrink-0"
          >
            <Icon name="arrowRight" size={12} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="card-soft p-4 border border-dng/30 bg-dng/5 text-sm text-dng">
            {error} · The cache may be empty if the backend just started — try again in a minute.
          </div>
        )}

        {/* The simulator turns generic market data into a personal decision —
            it sits above the raw panels on purpose. */}
        <InvestmentSimulator summary={summary} snapshot={snapshot} />

        <InsightPanel snapshot={snapshot} />

        <Section
          num="04"
          title="DSE · Live stocks"
          sub={`Dar es Salaam Stock Exchange · updated ${ages.dse}`}
          action={<Badge color="accent" dot>TZS</Badge>}
        >
          <DSEPanel payload={snapshot?.dse} />
        </Section>

        <Section
          num="05"
          title="Exchange rates"
          sub={`Bank of Tanzania · updated ${ages.bot}`}
          action={<Badge color="net" dot>FX</Badge>}
        >
          <ForexPanel bot={snapshot?.forex_bot} global={snapshot?.forex_global} />
        </Section>

        <Section
          num="06"
          title="EWURA fuel cap prices"
          sub={`Petroleum publications · updated ${ages.fuel}`}
          action={<Badge color="expense" dot>Monthly</Badge>}
        >
          <FuelPanel payload={snapshot?.fuel} />
        </Section>

        <div className="grid lg:grid-cols-2 gap-5">
          <Section
            num="07"
            title="Crypto"
            sub={`CoinGecko · updated ${ages.crypto}`}
            action={<Badge color="accent" dot>USD</Badge>}
          >
            <CryptoPanel payload={snapshot?.crypto} />
          </Section>

          <Section
            num="08"
            title="Global indices"
            sub={`Yahoo · updated ${ages.indices}`}
            action={<Badge color="net" dot>EQ</Badge>}
          >
            <IndicesPanel payload={snapshot?.indices} />
          </Section>
        </div>

        <Section
          num="09"
          title="Prediction markets"
          sub={`Polymarket · updated ${ages.predictions}`}
          action={<Badge color="muted" dot>YES %</Badge>}
        >
          <PredictionsPanel payload={snapshot?.predictions} />
        </Section>

        <Section num="10" title={t('mk.strategies.title')} sub="Allocation playbooks">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {STRATEGIES.map((strategy) => (
              <div key={strategy.title} className="bg-surface-4/50 border border-bdr/50 rounded-xl p-3 sm:p-4 card-hover min-w-0">
                <div className="flex items-start justify-between mb-3 gap-2">
                  <div className={`p-2 rounded-lg flex-shrink-0 ${strategy.color === 'inc' ? 'bg-inc/10' : strategy.color === 'dng' ? 'bg-dng/10' : strategy.color === 'exp' ? 'bg-exp/10' : 'bg-net/10'}`}>
                    <Icon name={strategy.icon} size={16} className={strategy.color === 'inc' ? 'text-inc' : strategy.color === 'dng' ? 'text-dng' : strategy.color === 'exp' ? 'text-exp' : 'text-net'} />
                  </div>
                  <Badge color={strategy.risk === 'Low' ? 'income' : strategy.risk === 'Medium' ? 'expense' : 'danger'} className="flex-shrink-0">{strategy.risk} Risk</Badge>
                </div>
                <h4 className="font-semibold text-sm mb-1.5 break-words">{strategy.title}</h4>
                <p className="text-xs text-txt-2 leading-relaxed">{strategy.desc}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section num="11" title={t('mk.cover.title')} sub="Insurance providers">
          <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
            {INSURANCE.map((provider) => (
              <div key={provider.name} className="bg-surface-4/50 border border-bdr/50 rounded-xl p-3 sm:p-4 min-w-0">
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <h4 className="font-semibold text-sm min-w-0 break-words">{provider.name}</h4>
                  <Badge color="muted" className="flex-shrink-0">{provider.type}</Badge>
                </div>
                <p className="text-xs text-txt-2 leading-relaxed">{provider.desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-txt-3">
            Listed for reference — PesaLens is not affiliated with any provider and does not earn commission.
          </p>
        </Section>

        <div className="card-soft p-3 sm:p-5 lg:p-6 border border-dng/20 bg-dng/5">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-dng/15 text-dng flex-shrink-0">
              <Icon name="alert" size={16} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-txt-1">Not financial advice</h3>
              <p className="text-xs sm:text-sm text-txt-2 mt-1 leading-relaxed break-words">
                {snapshot?.disclaimer || (
                  <>
                    The data and explanations on this page are educational summaries from public market sources and are NOT
                    financial advice. For investment, tax, or insurance decisions, consult a CMSA-licensed advisor in
                    Tanzania (or a similarly certified professional in your country) so any future misunderstandings are
                    avoided. PesaLens does not earn commission from any provider listed.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
};

export default MarketsPage;
