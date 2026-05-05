// Derives Balance Sheet and Profit & Loss reports from MOCK_MERCHANT.
// Pure functions so the same data can power on-screen views and exports.

const sumBy = (entries, predicate) =>
  entries.filter(predicate).reduce((acc, entry) => acc + (entry.amount || 0), 0);

export const buildBalanceSheet = (m) => {
  const entries = m.entries || [];
  const accountsReceivable = sumBy(entries, (e) => e.type === 'debt_owed');
  const inventory = sumBy(entries, (e) => e.type === 'expense' && (e.cat || '').toLowerCase() === 'stock');
  const accountsPayable = m.outstandingDebt - accountsReceivable;

  const assets = [
    { label: 'Cash on Hand', amount: m.cashOnHand },
    { label: 'Accounts Receivable', amount: accountsReceivable, hint: 'Customer credit issued (debt owed to you)' },
    { label: 'Inventory (Stock)', amount: inventory, hint: 'Estimated from recent stock entries' },
  ];
  const totalAssets = assets.reduce((acc, row) => acc + row.amount, 0);

  const liabilities = [
    { label: 'Accounts Payable', amount: Math.max(0, accountsPayable), hint: 'Supplier debt outstanding' },
  ];
  const totalLiabilities = liabilities.reduce((acc, row) => acc + row.amount, 0);

  const equity = [
    { label: "Owner's Equity", amount: totalAssets - totalLiabilities, hint: 'Assets minus liabilities (balancing figure)' },
  ];
  const totalEquity = equity.reduce((acc, row) => acc + row.amount, 0);

  return {
    asOf: new Date().toISOString().slice(0, 10),
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    totalEquity,
    totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
  };
};

export const buildProfitLoss = (m) => {
  const entries = m.entries || [];
  const expenseByCategory = {};
  entries
    .filter((entry) => entry.type === 'expense')
    .forEach((entry) => {
      const key = entry.cat || 'Other';
      expenseByCategory[key] = (expenseByCategory[key] || 0) + (entry.amount || 0);
    });

  const monthlyExpenseRows = Object.entries(expenseByCategory).map(([label, amount]) => ({ label, amount }));
  const expensesFromEntries = monthlyExpenseRows.reduce((acc, row) => acc + row.amount, 0);
  const otherOperating = Math.max(0, m.monthlyExpenses - expensesFromEntries);
  if (otherOperating > 0) {
    monthlyExpenseRows.push({ label: 'Other Operating Costs', amount: otherOperating });
  }

  const totalRevenue = m.monthlyRevenue;
  const totalExpenses = monthlyExpenseRows.reduce((acc, row) => acc + row.amount, 0);
  const grossProfit = totalRevenue - totalExpenses;
  const netMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  return {
    period: 'Current Month',
    asOf: new Date().toISOString().slice(0, 10),
    revenueRows: [{ label: 'Sales Revenue', amount: totalRevenue }],
    totalRevenue,
    expenseRows: monthlyExpenseRows,
    totalExpenses,
    grossProfit,
    netMargin,
  };
};

const fmtMoney = (value) => 'TZS ' + Number(value || 0).toLocaleString();

const escapeHtml = (str) =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const tableHtml = (rows, totalLabel, totalValue) => `
  <table>
    <tbody>
      ${rows
        .map(
          (row) => `
            <tr>
              <td>${escapeHtml(row.label)}</td>
              <td class="num">${fmtMoney(row.amount)}</td>
            </tr>`
        )
        .join('')}
      <tr class="total">
        <td>${escapeHtml(totalLabel)}</td>
        <td class="num">${fmtMoney(totalValue)}</td>
      </tr>
    </tbody>
  </table>`;

const reportShell = (title, asOf, body) => `
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title)}</title>
      <style>
        body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #111; padding: 32px; }
        h1 { font-size: 22px; margin: 0 0 4px; }
        .meta { color: #555; font-size: 12px; margin-bottom: 24px; }
        h2 { font-size: 14px; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: 0.04em; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 6px 0; font-size: 13px; border-bottom: 1px solid #eee; }
        td.num { text-align: right; font-variant-numeric: tabular-nums; }
        tr.total td { font-weight: 700; border-top: 2px solid #111; border-bottom: none; padding-top: 10px; }
        .footer { margin-top: 32px; font-size: 11px; color: #888; }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">As of ${escapeHtml(asOf)} &middot; PesaLens Bookkeeping</div>
      ${body}
      <div class="footer">Generated by PesaLens. Figures derived from current bookkeeping mock data.</div>
    </body>
  </html>`;

const printWindow = (html) => {
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) {
    alert('Please allow pop-ups to export the report.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try { w.print(); } catch (_) { /* user can print manually */ }
  }, 250);
};

export const exportBalanceSheetPDF = (sheet) => {
  const body = `
    <h2>Assets</h2>
    ${tableHtml(sheet.assets, 'Total Assets', sheet.totalAssets)}
    <h2>Liabilities</h2>
    ${tableHtml(sheet.liabilities, 'Total Liabilities', sheet.totalLiabilities)}
    <h2>Equity</h2>
    ${tableHtml(sheet.equity, 'Total Equity', sheet.totalEquity)}
    <h2>Balancing Check</h2>
    ${tableHtml(
      [
        { label: 'Total Assets', amount: sheet.totalAssets },
        { label: 'Total Liabilities + Equity', amount: sheet.totalLiabilitiesAndEquity },
      ],
      'Difference',
      sheet.totalAssets - sheet.totalLiabilitiesAndEquity
    )}`;
  printWindow(reportShell('Balance Sheet', sheet.asOf, body));
};

export const exportProfitLossPDF = (pl) => {
  const body = `
    <h2>Revenue</h2>
    ${tableHtml(pl.revenueRows, 'Total Revenue', pl.totalRevenue)}
    <h2>Operating Expenses</h2>
    ${tableHtml(pl.expenseRows, 'Total Expenses', pl.totalExpenses)}
    <h2>Net Profit</h2>
    ${tableHtml(
      [
        { label: 'Gross Profit', amount: pl.grossProfit },
        { label: 'Net Margin (%)', amount: Number(pl.netMargin.toFixed(2)) },
      ],
      'Net Profit',
      pl.grossProfit
    )}`;
  printWindow(reportShell(`Profit & Loss — ${pl.period}`, pl.asOf, body));
};

const xlsTable = (heading, rows, totalLabel, totalValue) => `
  <tr><td colspan="2" style="font-weight:bold;background:#eee;">${escapeHtml(heading)}</td></tr>
  ${rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.label)}</td>
          <td>${row.amount}</td>
        </tr>`
    )
    .join('')}
  <tr style="font-weight:bold;">
    <td>${escapeHtml(totalLabel)}</td>
    <td>${totalValue}</td>
  </tr>
  <tr><td colspan="2"></td></tr>`;

const xlsDocument = (title, asOf, inner) => `﻿<html xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns="http://www.w3.org/TR/REC-html40">
  <head><meta charset="utf-8"></head>
  <body>
    <table>
      <tr><td colspan="2" style="font-weight:bold;font-size:14pt;">${escapeHtml(title)}</td></tr>
      <tr><td colspan="2">As of ${escapeHtml(asOf)}</td></tr>
      <tr><td colspan="2"></td></tr>
      ${inner}
    </table>
  </body>
  </html>`;

export const exportBalanceSheetExcel = (sheet) => {
  const inner =
    xlsTable('Assets', sheet.assets, 'Total Assets', sheet.totalAssets) +
    xlsTable('Liabilities', sheet.liabilities, 'Total Liabilities', sheet.totalLiabilities) +
    xlsTable('Equity', sheet.equity, 'Total Equity', sheet.totalEquity);
  const html = xlsDocument('Balance Sheet', sheet.asOf, inner);
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  downloadBlob(blob, `balance-sheet-${sheet.asOf}.xls`);
};

export const exportProfitLossExcel = (pl) => {
  const inner =
    xlsTable('Revenue', pl.revenueRows, 'Total Revenue', pl.totalRevenue) +
    xlsTable('Expenses', pl.expenseRows, 'Total Expenses', pl.totalExpenses) +
    xlsTable(
      'Result',
      [
        { label: 'Gross Profit', amount: pl.grossProfit },
        { label: 'Net Margin (%)', amount: Number(pl.netMargin.toFixed(2)) },
      ],
      'Net Profit',
      pl.grossProfit
    );
  const html = xlsDocument(`Profit & Loss — ${pl.period}`, pl.asOf, inner);
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  downloadBlob(blob, `profit-loss-${pl.asOf}.xls`);
};

export const fmtReportMoney = fmtMoney;
