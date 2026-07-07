import React, { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/navigation';
import { Icon } from '../components/Icon';
import { ChartJS, chartTheme } from '../components/ChartJS';
import { TiltCard } from '../components/motion';
import { Badge, Drawer, EmptyState, Eyebrow, Segmented } from '../components/common';
import { fetchAnalysis, fetchDashboardSummary, fmtTZS, fmtTZSFull } from '../data/api';
import { useTheme } from '../data/theme';
import { useT } from '../data/i18n';

/* icon-chip tones for the KPI tiles */
const TONE = {
  accent: 'bg-accent/12 text-accent border-accent/25',
  exp:    'bg-exp/12 text-exp border-exp/25',
  inc:    'bg-inc/12 text-inc border-inc/25',
  net:    'bg-net/12 text-net border-net/25',
};

const AnalysisPage = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('date-desc');
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [catOpen, setCatOpen] = useState(false);
  const [activeCat, setActiveCat] = useState(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  const { t } = useT();
  const [theme] = useTheme();
  void theme;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const summary = await fetchDashboardSummary();
        if (cancelled) return;
        if (!summary?.latest_upload?.job_id) {
          setData(null);
          return;
        }
        const analysis = await fetchAnalysis(summary.latest_upload.job_id);
        if (!cancelled) setData(analysis);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load analysis');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const transactions = data?.transactions || [];
  const categories = data?.categories || [];
  const kpis = data?.kpis || {};

  const catTxns = useMemo(() => {
    if (!activeCat) return [];
    return transactions
      .filter((tx) => tx.category === activeCat.name && tx.debit)
      .sort((a, b) => (b.debit || 0) - (a.debit || 0));
  }, [transactions, activeCat]);

  const openCategory = (category) => { setActiveCat(category); setCatOpen(true); };

  const filtered = useMemo(() => {
    let txns = [...transactions];
    if (filter === 'income') txns = txns.filter((t) => t.credit);
    if (filter === 'expense') txns = txns.filter((t) => t.debit);

    const q = search.trim().toLowerCase();
    if (q) {
      txns = txns.filter((t) =>
        (t.description || '').toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q) ||
        String(t.txn_date || '').toLowerCase().includes(q)
      );
    }

    switch (sort) {
      case 'debit-high': txns.sort((a, b) => (b.debit || 0) - (a.debit || 0)); break;
      case 'debit-low':  txns.sort((a, b) => (a.debit || 0) - (b.debit || 0)); break;
      case 'credit-high': txns.sort((a, b) => (b.credit || 0) - (a.credit || 0)); break;
      case 'credit-low':  txns.sort((a, b) => (a.credit || 0) - (b.credit || 0)); break;
      case 'date-asc':  txns.sort((a, b) => String(a.txn_date || '').localeCompare(String(b.txn_date || ''))); break;
      default:          txns.sort((a, b) => String(b.txn_date || '').localeCompare(String(a.txn_date || '')));
    }
    return txns;
  }, [transactions, filter, sort, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filtered.length);
  const pageTxns = filtered.slice(pageStart, pageEnd);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <div className="flex items-center gap-3 text-sm text-txt-2 font-mono uppercase tracking-ticker">
            <span className="w-1.5 h-1.5 rounded-full bg-accent anim-pulse-soft" />
            {t('common.loading')} {t('nav.analysis').toLowerCase()}
          </div>
        </div>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell>
        <div className="p-4 bg-exp/10 border border-exp/30 rounded-xl text-sm text-exp">{error}</div>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell>
        <EmptyState icon="chart" title={t('an.empty.title')} desc={t('an.empty.desc')} />
      </AppShell>
    );
  }

  const meta = data.metadata || {};
  const th = chartTheme();
  const palette = th.palette;
  const catTotal = categories.reduce((s, c) => s + (c.value || 0), 0) || 1;

  const kpiTiles = [
    { label: t('common.totalTx'),       val: kpis.total_transactions ?? 0, icon: 'file',           tone: 'accent' },
    { label: t('common.largestExp'),    val: fmtTZS(kpis.largest_expense), icon: 'arrowDownRight', tone: 'exp' },
    { label: t('common.largestInc'),    val: fmtTZS(kpis.largest_income),  icon: 'arrowUpRight',   tone: 'inc' },
    { label: t('common.avgDailySpend'), val: fmtTZS(kpis.avg_daily_spend), icon: 'chart',          tone: 'net' },
  ];

  return (
    <AppShell>
      <div className="space-y-4 sm:space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <Eyebrow>{t('an.eyebrow')}</Eyebrow>
            <h1 className="mt-1.5 text-xl sm:text-2xl lg:text-[28px] font-semibold tracking-tight">{t('an.title')}</h1>
          </div>
          <span className="text-[11px] text-txt-3 font-mono uppercase tracking-ticker self-start sm:self-auto">
            {(meta.bank || t('common.bank')).toString()}
            {meta.period_start && meta.period_end ? ` · ${meta.period_start} → ${meta.period_end}` : ''}
          </span>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          {kpiTiles.map((item, idx) => (
            <TiltCard key={idx} max={6} className="bento p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-ticker text-txt-3 truncate">{item.label}</span>
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center border flex-shrink-0 ${TONE[item.tone]}`}>
                  <Icon name={item.icon} size={13} />
                </span>
              </div>
              <div className="text-lg lg:text-xl font-bold tabular tracking-tight truncate">{item.val}</div>
            </TiltCard>
          ))}
        </div>

        {/* Category bento — gauge + top categories */}
        {categories.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
            <TiltCard max={4} className="lg:col-span-5 bento p-5 lg:p-6">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <Eyebrow>{t('an.mix.eyebrow')}</Eyebrow>
                  <h3 className="mt-1.5 text-sm font-semibold tracking-tight">{t('an.mix.title')}</h3>
                </div>
                <Icon name="chart" size={16} className="text-txt-3" />
              </div>
              <div className="relative">
                <ChartJS
                  type="doughnut"
                  height={230}
                  data={{
                    labels: categories.map((c) => c.name),
                    datasets: [{
                      data: categories.map((c) => c.value),
                      backgroundColor: categories.map((c, i) => c.color || palette[i % palette.length]),
                      borderWidth: 0,
                    }],
                  }}
                  options={{
                    cutout: '72%',
                    onHover: (evt, els) => { if (evt?.native?.target) evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
                    onClick: (evt, els) => { if (els && els.length) { const category = categories[els[0].index]; if (category) openCategory(category); } },
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        backgroundColor: th.tooltipBg, borderColor: th.tooltipBorder, borderWidth: 1, padding: 10,
                        titleColor: th.tooltipTitle, bodyColor: th.tooltipBody,
                        callbacks: { label: (ctx) => `${ctx.label}: ${fmtTZSFull(ctx.raw)}` },
                      },
                    },
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <div className="text-[10px] uppercase tracking-ticker text-txt-3 font-mono">{t('dash.mix.total')}</div>
                    <div className="text-lg font-bold tabular text-txt-1">{fmtTZS(catTotal)}</div>
                  </div>
                </div>
              </div>
            </TiltCard>

            <div className="lg:col-span-7 bento p-5 lg:p-6">
              <div className="mb-5">
                <Eyebrow>{t('an.top.eyebrow')}</Eyebrow>
                <h3 className="mt-1.5 text-sm font-semibold tracking-tight">{t('an.top.title')}</h3>
              </div>
              <div className="space-y-4">
                {categories.slice(0, 6).map((category, idx) => {
                  const max = categories[0]?.value || 1;
                  const pct = Math.max(4, Math.round((category.value / max) * 100));
                  const color = category.color || palette[idx % palette.length];
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => openCategory(category)}
                      className="group w-full text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-lg -mx-1 px-1 py-0.5"
                      title={t('an.cat.viewTx')}
                    >
                      <div className="flex justify-between items-baseline text-sm mb-1.5">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-[10px] tabular text-txt-3 w-5">0{idx + 1}</span>
                          <span className="font-medium text-txt-1 group-hover:text-accent transition-colors">{category.name}</span>
                        </div>
                        <span className="text-txt-2 tabular text-xs font-medium flex items-center gap-1.5">
                          {fmtTZS(category.value)}
                          <span className="text-txt-4">·</span>
                          <span className="text-txt-3">{((category.value / catTotal) * 100).toFixed(0)}%</span>
                          <Icon name="chevRight" size={12} className="text-txt-4 group-hover:text-accent transition-colors" />
                        </span>
                      </div>
                      <div className="h-1.5 bg-surface-4 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: color, boxShadow: `0 0 10px ${color}` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            options={[
              { key: 'all',     label: t('common.all') },
              { key: 'income',  label: t('common.income') },
              { key: 'expense', label: t('common.expense') },
            ]}
            value={filter}
            onChange={(v) => { setFilter(v); setPage(0); }}
          />
          <select
            value={sort}
            onChange={(event) => { setSort(event.target.value); setPage(0); }}
            className="bg-surface-3 border border-bdr rounded-lg px-3 py-2 text-xs text-txt-1"
          >
            <option value="date-desc">{t('an.sort.latest')}</option>
            <option value="date-asc">{t('an.sort.oldest')}</option>
            <option value="debit-high">{t('an.sort.dh')}</option>
            <option value="debit-low">{t('an.sort.dl')}</option>
            <option value="credit-high">{t('an.sort.ch')}</option>
            <option value="credit-low">{t('an.sort.cl')}</option>
          </select>
          <div className="relative flex-1 min-w-[160px] sm:min-w-[220px]">
            <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-txt-3" />
            <input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(0); }}
              placeholder={t('an.search')}
              className="w-full bg-surface-3 border border-bdr rounded-lg pl-9 pr-4 py-2 text-xs text-txt-1 placeholder-txt-3"
            />
          </div>
          <div className="ml-auto font-mono text-[10px] uppercase tracking-ticker text-txt-3 tabular">
            {filtered.length} {t('common.of')} {transactions.length}
          </div>
        </div>

        {/* Transactions */}
        <div className="bento overflow-hidden">
          {/* MOBILE — card stack */}
          <div className="md:hidden divide-y divide-bdr/40">
            {pageTxns.map((transaction) => {
              const isCredit = !!transaction.credit;
              return (
                <button
                  key={transaction.row_index}
                  type="button"
                  onClick={() => { setSelected(transaction); setDrawerOpen(true); }}
                  className="w-full text-left px-4 py-3.5 hover:bg-surface-4/40 transition-colors active:bg-surface-4/60"
                >
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-txt-1 leading-snug truncate">{transaction.description || '—'}</p>
                      <p className="text-[11px] text-txt-3 font-mono mt-0.5 tabular">{transaction.txn_date || '—'}</p>
                    </div>
                    <div className={`text-sm font-semibold tabular flex-shrink-0 ${isCredit ? 'text-inc' : 'text-exp'}`}>
                      {isCredit ? '+' : '−'}{fmtTZS(transaction.credit ?? transaction.debit ?? 0)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Badge color={isCredit ? 'income' : 'muted'}>{transaction.category || t('an.uncategorized')}</Badge>
                    {transaction.balance != null && (
                      <span className="text-[10px] font-mono text-txt-3 tabular">bal · {fmtTZSFull(transaction.balance)}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* DESKTOP — table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bdr bg-surface-4/40 text-txt-3 text-left">
                  <th className="px-4 lg:px-5 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium">{t('common.date')}</th>
                  <th className="px-4 lg:px-5 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium">{t('common.description')}</th>
                  <th className="px-4 lg:px-5 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium">{t('common.category')}</th>
                  <th className="px-4 lg:px-5 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium text-right">{t('common.debit')}</th>
                  <th className="px-4 lg:px-5 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium text-right">{t('common.credit')}</th>
                  <th className="hidden lg:table-cell px-4 lg:px-5 py-3 font-mono text-[10px] uppercase tracking-ticker font-medium text-right">{t('common.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {pageTxns.map((transaction) => (
                  <tr
                    key={transaction.row_index}
                    onClick={() => { setSelected(transaction); setDrawerOpen(true); }}
                    className="border-b border-bdr/30 hover:bg-surface-4/40 cursor-pointer transition-colors group"
                  >
                    <td className="px-4 lg:px-5 py-3.5 text-txt-3 whitespace-nowrap font-mono text-xs tabular">{transaction.txn_date || '—'}</td>
                    <td className="px-4 lg:px-5 py-3.5 font-medium text-txt-1 max-w-[18ch] lg:max-w-md truncate group-hover:text-accent transition-colors" title={transaction.description}>
                      {transaction.description || '—'}
                    </td>
                    <td className="px-4 lg:px-5 py-3.5">
                      <Badge color={transaction.credit ? 'income' : 'muted'}>{transaction.category || t('an.uncategorized')}</Badge>
                    </td>
                    <td className="px-4 lg:px-5 py-3.5 text-right text-exp tabular font-medium">{transaction.debit ? fmtTZSFull(transaction.debit) : <span className="text-txt-4">—</span>}</td>
                    <td className="px-4 lg:px-5 py-3.5 text-right text-inc tabular font-medium">{transaction.credit ? fmtTZSFull(transaction.credit) : <span className="text-txt-4">—</span>}</td>
                    <td className="hidden lg:table-cell px-4 lg:px-5 py-3.5 text-right text-txt-2 tabular font-mono text-xs">{transaction.balance != null ? fmtTZSFull(transaction.balance) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <p className="text-sm text-txt-3 py-10 text-center">No transactions match the current filters.</p>
          )}
          {filtered.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-bdr/50 flex-wrap gap-3">
              <p className="text-xs sm:text-sm text-txt-3 tabular">
                {t('common.showing')} {pageStart + 1}–{pageEnd} {t('common.of')} {filtered.length}
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                    className="px-3 py-1.5 text-xs sm:text-sm rounded-lg border border-bdr bg-surface-3 hover:bg-surface-4 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {t('common.previous')}
                  </button>
                  <span className="text-xs sm:text-sm text-txt-2 tabular">{currentPage + 1} / {totalPages}</span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={currentPage >= totalPages - 1}
                    className="px-3 py-1.5 text-xs sm:text-sm rounded-lg border border-bdr bg-surface-3 hover:bg-surface-4 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {t('common.next')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={t('an.tx.detail')}>
          {selected && (
            <div className="space-y-4">
              <div className="p-4 bg-surface-3 rounded-xl border border-bdr">
                <div className="text-xs text-txt-3 mb-1 font-mono tabular">{selected.txn_date || '—'}</div>
                <div className="text-lg font-bold mb-2 text-txt-1 break-words">{selected.description || '—'}</div>
                <Badge color={selected.credit ? 'income' : 'muted'}>{selected.category || t('an.uncategorized')}</Badge>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between py-2 border-b border-bdr/50">
                  <span className="text-txt-2">{t('common.debit')}</span>
                  <span className="text-exp font-medium tabular">{selected.debit ? fmtTZSFull(selected.debit) : '—'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-bdr/50">
                  <span className="text-txt-2">{t('common.credit')}</span>
                  <span className="text-inc font-medium tabular">{selected.credit ? fmtTZSFull(selected.credit) : '—'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-bdr/50">
                  <span className="text-txt-2">{t('common.balance')}</span>
                  <span className="font-medium text-txt-1 tabular">{selected.balance != null ? fmtTZSFull(selected.balance) : '—'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-bdr/50 gap-3">
                  <span className="text-txt-2 flex-shrink-0">{t('an.reference')}</span>
                  <span className="font-medium text-xs text-txt-1 break-all text-right">{selected.reference || '—'}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-txt-2">{t('an.pageNo')}</span>
                  <span className="font-medium text-txt-1 tabular">{selected.page_number ?? '—'}</span>
                </div>
              </div>
            </div>
          )}
        </Drawer>

        <Drawer
          open={catOpen}
          onClose={() => setCatOpen(false)}
          eyebrow={activeCat ? fmtTZSFull(activeCat.value) : ''}
          title={activeCat?.name || t('common.category')}
        >
          {activeCat && (
            <div className="space-y-4">
              <div className="p-4 bg-surface-3 rounded-xl border border-bdr flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: activeCat.color || '#94A3B8' }} />
                  <span className="font-semibold text-txt-1 truncate">{activeCat.name}</span>
                </div>
                <span className="text-[11px] font-mono uppercase tracking-ticker text-txt-3 whitespace-nowrap">
                  {catTxns.length} {t('common.of')} {transactions.length}
                </span>
              </div>

              {catTxns.length === 0 ? (
                <p className="text-sm text-txt-3 py-8 text-center">{t('an.cat.empty')}</p>
              ) : (
                <div className="divide-y divide-bdr/40 -mx-1">
                  {catTxns.map((transaction) => (
                    <button
                      key={transaction.row_index}
                      type="button"
                      onClick={() => { setCatOpen(false); setSelected(transaction); setDrawerOpen(true); }}
                      className="w-full text-left px-1 py-3 hover:bg-surface-4/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-txt-1 leading-snug truncate">{transaction.description || '—'}</p>
                          <p className="text-[11px] text-txt-3 font-mono mt-0.5 tabular">{transaction.txn_date || '—'}</p>
                        </div>
                        <div className="text-sm font-semibold tabular flex-shrink-0 text-exp">−{fmtTZS(transaction.debit ?? 0)}</div>
                      </div>
                      {transaction.balance != null && (
                        <span className="text-[10px] font-mono text-txt-3 tabular">bal · {fmtTZSFull(transaction.balance)}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Drawer>
      </div>
    </AppShell>
  );
};

export default AnalysisPage;
