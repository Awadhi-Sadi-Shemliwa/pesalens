import { useEffect, useState, useCallback } from 'react';

/* ----------------------------------------------------------------
   Translation registry — single source of truth.
   Components reference keys via t('nav.dashboard'); switching the
   language re-renders the whole tree. No per-string conditionals.
   ---------------------------------------------------------------- */
const dict = {
  en: {
    /* Navigation */
    'nav.workspace':        'Workspace',
    'nav.dashboard':        'Dashboard',
    'nav.analysis':         'Analysis',
    'nav.assistant':        'AI Assistant',
    'nav.markets':          'Markets',
    'nav.simulator':        'Simulator',
    'nav.bookkeeping':      'Bookkeeping',
    'nav.personal':         'Personal Spending',
    'nav.reconcile':        'Reconciliation',
    'nav.collapse':         'Collapse',
    'nav.product':          'Product',
    'nav.startTrial':       'Start free trial',
    'nav.features':         'Features',
    'nav.signin':           'Sign In',
    'nav.openAccount':      'Open an account',
    'nav.upgrade':          'Upgrade',
    'nav.proTier':          'Pro tier',
    'nav.proCopy':          'Unlimited statements, multi-account roll-up, custom alerts.',
    'nav.trialDays':        '{n} days left in trial',
    'nav.trialEnded':       'Trial expired',
    'nav.proActive':        'Pro · active',
    'nav.search':           'Search transactions, merchants, insights…',
    'nav.profile':          'Profile',
    'nav.settings':         'Settings',
    'nav.signout':          'Sign Out',
    'nav.help':             'Help',
    'nav.toggleTheme':      'Toggle theme',
    'nav.language':         'Language',

    /* Common labels */
    'common.bank':          'Bank',
    'common.transactions':  'Transactions',
    'common.moneyIn':       'Money in',
    'common.moneyOut':      'Money out',
    'common.netFlow':       'Net flow',
    'common.savingsRate':   'Savings rate',
    'common.savings':       'Savings',
    'common.expenseGrowth': 'Expense growth',
    'common.incomeGrowth':  'Income growth',
    'common.totalTx':       'Total transactions',
    'common.largestExp':    'Largest expense',
    'common.largestInc':    'Largest income',
    'common.avgDailySpend': 'Avg daily spend',
    'common.date':          'Date',
    'common.description':   'Description',
    'common.category':      'Category',
    'common.debit':         'Debit',
    'common.credit':        'Credit',
    'common.balance':       'Balance',
    'common.openingBalance':'Opening balance',
    'common.balanceNow':    'Balance now',
    'common.amount':        'Amount',
    'common.method':        'Method',
    'common.type':          'Type',
    'common.vendor':        'Vendor',
    'common.income':        'Income',
    'common.expense':       'Expense',
    'common.all':           'All',
    'common.search':        'Search',
    'common.export':        'Export',
    'common.cancel':        'Cancel',
    'common.save':          'Save',
    'common.close':         'Close',
    'common.previous':      'Previous',
    'common.next':          'Next',
    'common.page':          'Page',
    'common.of':            'of',
    'common.showing':       'Showing',
    'common.online':        'online',
    'common.loading':       'loading',
    'common.live':          'live',
    'common.estimated':     'estimated',
    'common.parsed':        'parsed',
    'common.locked':        '— locked —',
    'common.warning':       'Warning',
    'common.critical':      'Critical',
    'common.notice':        'Notice',

    /* Landing */
    'land.eyebrow':         'Built for Tanzania · Made for clarity',
    'land.title.l1':        'Read your money',
    'land.title.like':      'like',
    'land.title.l2':        'a banker reads it.',
    'land.lede':            'PesaLens turns any bank statement — CRDB, NMB, NBC, M-Pesa, Airtel — into a clean ledger of every shilling, then walks you through it like a financial controller would. Without the spreadsheet.',
    'land.tryDemo':         'Start your 14-day free trial',
    'land.openFree':        'Open a free account',
    'land.startTrial':      'Start 14-day free trial',
    'land.systemOk':        'System operational',
    'land.trial':           '14-day trial · no card',
    'land.soc2':            'Encrypted in transit (HTTPS)',
    'land.encryption':      'Statements never resold',
    'land.heroLabel':       'Net flow this month',
    'land.heroSub':         'statement · live',
    'land.method.eyebrow':  'Method',
    'land.method.title.l1': 'Statement in.',
    'land.method.title.l2': 'Clarity',
    'land.method.title.l3': 'out.',
    'land.method.lede':     "Three deliberate steps. No data entry, no spreadsheets, no exports to a generic dashboard you'll never open twice.",
    'land.step.ingest':     'Ingest',
    'land.step.reconcile':  'Reconcile',
    'land.step.decide':     'Decide',
    'land.step.1.title':    'Drop a statement',
    'land.step.1.desc':     'PDFs from CRDB, NMB, NBC, Stanbic, M-Pesa, Airtel Money — even photographed pages.',
    'land.step.2.title':    'We read every line',
    'land.step.2.desc':     'OCR + ledger logic extracts each transaction, classifies it, and balances against the closing figure.',
    'land.step.3.title':    'Ask, compare, act',
    'land.step.3.desc':     'KPIs, anomalies, fee leakage, savings rate and an AI controller you can question in plain English.',
    'land.cap.eyebrow':     'Capabilities',
    'land.cap.title.l1':    'One workspace.',
    'land.cap.title.l2':    'Every',
    'land.cap.title.l3':    'money question.',
    'land.cap.lede':        "Each module is built for the job it does — not stamped from the same template. Spend five minutes; you'll feel it.",
    'land.why.eyebrow':     'Why PesaLens',
    'land.why.title.l1':    'Stop reading bank statements',
    'land.why.title.l2':    'by hand.',
    'land.why.lede':        "Whether you're an individual tracking groceries or a vendor closing the books at the end of the day — PesaLens replaces a folder of PDFs with one continuously-reconciled view of your money.",
    'land.cta.eyebrow':     'Get started',
    'land.cta.title.l1':    'Open PesaLens.',
    'land.cta.title.l2':    'Upload one statement.',
    'land.cta.lede':        "Free trial for 14 days. No card. We'll have your numbers talking back to you in under a minute.",
    'land.cta.tryFirst':    'Start 14-day free trial',
    'land.cta.create':      'Create free account',
    'land.cta.fine':        'Encrypted in transit · Statements never resold · Delete your data any time',
    'foot.product':         'Product',
    'foot.company':         'Company',
    'foot.legal':           'Legal',
    'foot.tag':             'Financial intelligence for individuals and small businesses across Tanzania.',
    'foot.copy':            '© 2026 PesaLens · All rights reserved',
    'foot.built':           'Built in Tanzania',

    /* Dashboard */
    'dash.eyebrow':         'Dashboard',
    'dash.welcome':         'Welcome to PesaLens.',
    'dash.welcomeSub':      "Upload your first bank statement and we'll do the rest — extraction, categorization, balance check, fee analysis.",
    'dash.uploadAnother':   'Upload another',
    'dash.uploading':       'Uploading…',
    'dash.upload.eyebrow':  'Ingest',
    'dash.upload.title':    'Upload a bank statement',
    'dash.upload.subtitle': 'PDF · max 50MB',
    'dash.upload.drop':     'Drop your statement here, or click to browse',
    'dash.upload.banks':    'CRDB · NMB · NBC · Stanbic · M-Pesa · Airtel Money',
    'dash.upload.ready':    'ready',
    'dash.upload.extract':  'Extract transactions',
    'dash.upload.extracting': 'Extracting…',
    'dash.empty.title':     'Nothing to chart yet',
    'dash.empty.desc':      'Once you upload, every transaction is parsed, classified, and reconciled. After three statements your trend KPIs unlock automatically.',
    'dash.fee.eyebrow':     'Fee leakage',
    'dash.fee.occurrences': 'occurrences',
    'dash.recon.eyebrow':   'Reconciliation',
    'dash.recon.balance':   'balance check',
    'dash.recon.closing':   'Statement closing',
    'dash.recon.computed':  'Computed (in − out)',
    'dash.recon.discrepancy': 'Discrepancy',
    'dash.anom.eyebrow':    'Anomalies',
    'dash.anom.flagged':    'flagged',
    'dash.cf.eyebrow':      'Cash flow',
    'dash.cf.title':        'Income vs expenses',
    'dash.mix.eyebrow':     'Mix',
    'dash.mix.title':       'Spending breakdown',
    'dash.mix.total':       'Total',
    'dash.lockedHint':      'more statement to unlock',
    'dash.lockedHint.p':    'more statements to unlock',

    /* Analysis */
    'an.eyebrow':           'Analysis',
    'an.title':             'Statement breakdown',
    'an.mix.eyebrow':       'Mix',
    'an.mix.title':         'Spending by category',
    'an.top.eyebrow':       'Top categories',
    'an.top.title':         'Where it goes',
    'an.cat.viewTx':        'View transactions',
    'an.cat.empty':         'No transactions in this category.',
    'an.search':            'Search transactions, categories…',
    'an.sort.latest':       'Latest first',
    'an.sort.oldest':       'Oldest first',
    'an.sort.dh':           'Debit: high → low',
    'an.sort.dl':           'Debit: low → high',
    'an.sort.ch':           'Credit: high → low',
    'an.sort.cl':           'Credit: low → high',
    'an.uncategorized':     'Uncategorized',
    'an.empty.title':       'No statement to analyze',
    'an.empty.desc':        'Upload a bank statement on the Dashboard to see a detailed breakdown here.',
    'an.tx.detail':         'Transaction detail',
    'an.reference':         'Reference',
    'an.pageNo':            'Page',

    /* Assistant */
    'ai.title':             'PesaLens AI',
    'ai.subtitle':          'grounded on your statement',
    'ai.placeholder':       'Ask about your finances…',
    'ai.welcome':           "Welcome to PesaLens AI Assistant. Upload a statement on the Dashboard if you haven't already, then ask me anything — I can explain spending patterns, surface savings opportunities, and walk through specific transactions.",
    'ai.suggest.1':         'Explain my biggest expenses this month',
    'ai.suggest.2':         'How can I reduce unnecessary spending?',
    'ai.suggest.3':         'What categories drained the most money?',
    'ai.suggest.4':         'What investment strategy fits my cash flow?',
    'ai.snapshot.eyebrow':  'Statement',
    'ai.snapshot.title':    'Snapshot',
    'ai.spending.eyebrow':  'Spending',
    'ai.spending.title':    'Top categories',
    'ai.anom.eyebrow':      'Anomalies',
    'ai.anom.title':        'Flagged',
    'ai.anom.empty':        'Nothing flagged on the latest statement.',
    'ai.snapshot.empty':    'No statement uploaded yet.',
    'ai.spending.empty':    'Upload a statement to see categories.',
    'ai.no':                'No statement uploaded yet.',
    'ai.hello':             'Hello, {name}',
    'ai.howHelp':           'How can I help with your money today?',
    'ai.explore':           'What would you like to explore?',
    'ai.send':              'Send',
    'ai.export':            'Export chat',
    'ai.copied':            'Copied',
    'ai.flagged':           'flagged',
    'ai.card.statement':    'Give me a plain-English summary of my latest statement.',
    'ai.card.spending':     'Which categories drained the most money, and why?',
    'ai.card.anomalies':    'Explain the issues flagged on my statement and how to fix them.',

    /* Markets — Ask the Advisor (chat panel) */
    'mki.eyebrow':          'Ask the Market Advisor',
    'mki.heading':          'PesaLens AI · {dse} stocks · {fx} currencies · {coins} coins',
    'mki.sub':              'Educational answers in plain English / Swahili — never a buy/sell instruction.',
    'mki.badge':            'Live context',
    'mki.try':              'Try one of these:',
    'mki.placeholder':      'Ask about TZS, fuel, DSE, crypto…',
    'mki.ask':              'Ask',
    'mki.retry':            'Retry',
    'mki.offline.title':    'AI advisor is offline',
    'mki.offline.body':     'The market data is current but the language model is not configured on this server. Set GEMINI_API_KEY or OPENROUTER_API_KEY in the backend .env to enable personalised explanations. The raw context above is still accurate.',
    'mki.error.generic':    'Could not reach the advisor.',
    'mki.error.network':    'Network error — your backend is not reachable from this device.',
    'mki.error.unauth':     'Your session expired. Sign in again to ask the advisor.',
    'mki.error.plan':       'Your trial has ended. Upgrade to keep asking the advisor.',
    'mki.quick.1':          'Why is the Tanzanian Shilling weaker than the dollar?',
    'mki.quick.2':          'Should I save in TZS or USD right now?',
    'mki.quick.3':          'How does DSE compare with the S&P 500?',
    'mki.quick.4':          'What does Polymarket tell us about global sentiment?',
    'mki.quick.5':          'Why do EWURA fuel prices change every month?',

    /* Action engine — Top mistakes / opportunities / 30-day plan */
    'act.eyebrow':          'Action engine',
    'act.title':            'What to actually change — based on your statement',
    'act.lede':             'Three sections, all personalised to your numbers. Read top-to-bottom: what is leaking, what you can capture, then exactly what to do over the next 30 days.',
    'act.badge':            'Decisions, not data',
    'act.kpi.surplus':      'Spare cash each month',
    'act.kpi.savings':      'Savings rate',
    'act.kpi.savings.bench':'(20% is healthy)',
    'act.kpi.mistakes':     'Money leaks',
    'act.kpi.wins':         'Wins waiting',

    /* Hero summary */
    'act.hero.healthy':     'Your statement looks healthy. Below are wins you could still capture and a 30-day plan to keep momentum.',
    'act.hero.deficit':     'You spend more than you earn each month. The biggest fix is below — start there before anything else.',
    'act.hero.tight':       'Your savings rate is below the 20% benchmark — you are leaving money on the table. The fixes below add up to real progress in one month.',
    'act.hero.strong':      'You have spare cash and a healthy savings rate — the biggest opportunities below are about putting that money to work, not just keeping it.',

    /* Section headers */
    'act.section.mistakes.title': 'What is leaking your money',
    'act.section.mistakes.lede':  'Each item below is costing you real shillings every month. Fix the top one first — it has the biggest payoff.',
    'act.section.opps.title':     'Wins you can capture',
    'act.section.opps.lede':      'Real money you could redirect or earn — without working harder. Pick one and act this week.',
    'act.section.plan.title':     'Your 30-day plan',
    'act.section.plan.lede':      'Concrete steps in the right order. Each one is sized so you can finish it without rearranging your life.',

    /* Card chrome */
    'act.fix.label':        'How to fix it',
    'act.win.label':        'How to capture it',
    'act.cost.monthly':     'per month',
    'act.gain.year':        'per year potential',
    'act.opps.potential':   'potential',

    /* Empty / done state */
    'act.empty.mistakes':   'Nothing flagged — this statement looks clean.',
    'act.empty.opps':       'No opportunities surfaced yet — upload another month so we can spot patterns.',

    /* CTA at bottom */
    'act.cta.title':        'Next — make this money grow',
    'act.cta.body':         'Once one of the wins above is captured, head to the Markets simulator. It shows exactly how much of your surplus you can invest without touching your daily life.',
    'act.cta.button':       'Open the simulator',

    /* Investment simulator — three-step decision wizard */
    'sim.eyebrow':          'Your money × the market',
    'sim.title':            'Can I invest? And if so, how — without breaking my month?',
    'sim.lede':             'A three-step guide built from your own statement. No jargon, no pressure — just numbers that make sense.',
    'sim.badge':            'Personalised',

    /* Simulator page header */
    'sim.page.eyebrow':     'Simulator',
    'sim.page.title':       'Plan your first investment',
    'sim.page.desc':        'Turn your statement into a decision — how much you can safely invest each month, where to put it, and what it could become.',

    /* Hero — the headline number */
    'sim.hero.eyebrow':     'Your starting point',
    'sim.hero.title':       'You can comfortably invest about',
    'sim.hero.subtitle':    'every month — without touching your lifestyle.',
    'sim.hero.explainer':   'This is 15% of your monthly surplus (what is left after expenses). Most people start here because it is big enough to grow, small enough not to hurt if a bill surprises you.',
    'sim.hero.surplus':     'You earn',
    'sim.hero.spend':       'You spend',
    'sim.hero.left':        'You have left',

    /* Step 1 — pick the amount */
    'sim.step1.eyebrow':    'Step 1',
    'sim.step1.title':      'How much will you put in each month?',
    'sim.step1.lede':       'Pick the level that feels comfortable. This is what you would invest every single month going forward.',
    'sim.step1.recommend':  'Recommended for you',
    'sim.step1.recommend.tail': 'You can change anytime.',
    'sim.tier.safe.title':         'Just dip a toe',
    'sim.tier.moderate.title':     'Build the habit',
    'sim.tier.aggressive.title':   'Go bigger',
    'sim.tier.safe.short':         '5% of your spare cash',
    'sim.tier.moderate.short':     '15% of your spare cash',
    'sim.tier.aggressive.short':   '30% of your spare cash',
    'sim.tier.safe.bestFor':       'Best if this is your first time investing or your income changes month to month. You will not feel this leave your account.',
    'sim.tier.moderate.bestFor':   'Best if your income is steady and you already have some savings. Most people land here.',
    'sim.tier.aggressive.bestFor': 'Best if your emergency fund is set and you are okay seeing big ups and downs. Save this for later if you are unsure.',

    /* Recommendation reasons */
    'sim.recommend.safe.tiny':         'Your monthly surplus is small right now — start at the safe level so the habit forms without strain. You can always increase later.',
    'sim.recommend.safe.unsteady':     'Your savings rate is still building — the safe level lets you invest without putting pressure on next month.',
    'sim.recommend.moderate.steady':   'Your cash flow is steady and your savings rate is healthy — moderate is the sweet spot for steady wealth building.',
    'sim.recommend.aggressive.headroom':'You have a strong surplus and a healthy savings rate — you can afford to push harder if you want.',

    /* Step 2 — pick where the money goes */
    'sim.step2.eyebrow':    'Step 2',
    'sim.step2.title':      'Where will the money go?',
    'sim.step2.lede':       'Each option has different growth and different risk. Pick the one that fits how comfortable you are with ups and downs.',
    'sim.cat.stocks.title':   'Tanzanian Stocks (DSE)',
    'sim.cat.stocks.body':    'Buy a small piece of a real Tanzanian company. You earn a share of its profits and growth.',
    'sim.cat.stocks.bestFor': 'Long-term wealth, Tanzania-focused.',
    'sim.cat.stable.title':   'USD Stablecoins',
    'sim.cat.stable.body':    'Digital tokens that hold US dollar value. Acts like a savings account in dollars — protects you from TZS weakening.',
    'sim.cat.stable.bestFor': 'Storing value, not big growth.',
    'sim.cat.crypto.title':   'Crypto (Bitcoin / Ethereum etc.)',
    'sim.cat.crypto.body':    'Digital currencies that swing hard — very high growth potential, very high risk. Only invest what you can afford to lose for years.',
    'sim.cat.crypto.bestFor': 'High-risk, high-reward, long horizon.',
    'sim.cat.typicalReturn': 'Typical yearly growth',
    'sim.cat.typicalRisk':   'Typical short-term swing',
    'sim.cat.pickAsset':     'Pick a specific asset',
    'sim.cat.empty':         'No assets in this category right now — try another.',
    'sim.cat.showAll':       'Show all',
    'sim.cat.showLess':      'Show fewer',

    /* Risk labels (same keys as before, kept) */
    'sim.risk.suffix':      'risk',
    'sim.risk.Low':         'Low',
    'sim.risk.Medium':      'Medium',
    'sim.risk.High':        'High',
    'sim.risk.Extreme':     'Extreme',

    /* Step 3 — what happens */
    'sim.step3.eyebrow':    'Step 3',
    'sim.step3.title':      'So what actually happens if you do this?',
    'sim.step3.lede':       'Three honest answers, based on the amount and asset you picked above.',

    /* Buy breakdown — share/coin count + advice when budget is short.
       Three asset classes get their own copy: DSE (board lots),
       CRYPTO (exchange minimum order), STABLE (whole tokens). */
    'sim.buy.title':        'How many you can buy with this amount',
    'sim.buy.budget':       'Your monthly budget',
    'sim.buy.price':        'Asset price',
    'sim.buy.canBuy':       'You can buy',
    'sim.buy.howTo':        'How to retain enough value to start',

    /* DSE — Tanzanian-stock variant */
    'sim.buy.dse.ok.head':   'You can buy {units} shares of {symbol} this month.',
    'sim.buy.dse.ok.body':   'That uses {cost} of your monthly allocation, leaving {leftover} idle. Repeat the same buy every month and the position grows steadily.',
    'sim.buy.dse.ok.note':   'DSE shares trade in board lots of 10. One lot of this stock costs {lotCost}.',
    'sim.buy.dse.short.head':'A board lot is {lotQty} shares of {symbol} — that costs {lotCost}. Your current allocation does not reach that yet.',
    'sim.buy.dse.short.body':'You are {shortfall} short. The DSE will not let you buy fewer than 10 shares, so {cash} a month sits as cash until you reach the lot price.',

    /* CRYPTO — Bitcoin / Ethereum / altcoin variant */
    'sim.buy.crypto.ok.head':   'You can buy about {units} {symbol} this month.',
    'sim.buy.crypto.ok.body':   'That uses {cost} of your monthly allocation. Crypto trades fractionally — every shilling above the exchange minimum buys a slice of {symbol}, no whole-coin requirement.',
    'sim.buy.crypto.ok.note':   'Most exchanges (Binance P2P, KuCoin, Yellow Card) reject orders under about {lotCost} (~$1 USD). You are above that floor.',
    'sim.buy.crypto.short.head':'Most crypto exchanges enforce a minimum order around {lotCost} (≈ $1 USD). Below that the order is rejected even though {symbol} trades fractionally.',
    'sim.buy.crypto.short.body':'You are {shortfall} short of the practical minimum. {cash} a month sits as cash — the exchange will not place the order until you reach the floor.',

    /* STABLE — USDT / USDC / DAI variant */
    'sim.buy.stable.ok.head':   'You can buy {units} {symbol} tokens this month.',
    'sim.buy.stable.ok.body':   '{symbol} is pegged to the US dollar, so each token holds ≈ $1 of value. {cost} of your allocation buys whole tokens; {leftover} stays as TZS.',
    'sim.buy.stable.ok.note':   'One {symbol} token costs about {lotCost} at today\'s rate.',
    'sim.buy.stable.short.head':'One {symbol} token costs about {lotCost} (≈ $1 USD). Your current allocation does not yet cover a single whole token.',
    'sim.buy.stable.short.body':'You are {shortfall} short. P2P sellers won\'t deal in less than 1 USDT/USDC, so {cash} a month sits as cash until you can clear one token.',

    /* Shared "how to fix it" lines */
    'sim.buy.fix.save':     'Hold the same allocation for {months} months — you would have saved enough ({months} × {cash} ≥ {lotCost}). Park the cash in a savings account or stablecoin so it earns something while you wait.',
    'sim.buy.fix.upgrade':  'Switch to the {tier} tier ({cash}/month) — that single bump puts the minimum within reach this month.',
    'sim.buy.fix.upgrade.cta': 'Use this tier',
    'sim.buy.fix.cheaper':  'Pick a cheaper DSE listing — for example {cheaperSymbol}, where one lot is {cheaperLot}. Same exchange, same broker, just a smaller ticket.',
    'sim.buy.fix.cheaper.cta': 'Switch to {symbol}',
    'sim.buy.fix.stableSwap':  'Switch to a stablecoin — {stableSymbol} costs about {stableLot} per token (≈ $1 USD), so any positive allocation buys at least one whole token. Lower volatility, same crypto rails.',
    'sim.buy.fix.stableSwap.cta': 'Switch to {symbol}',
    'sim.buy.fix.trim':     'Free up {shortfall} from another category (Action Plan flags the easiest cuts). The closer your surplus gets to the minimum, the less you have to wait.',
    'sim.buy.fix.tooSmall': 'Even your full monthly surplus ({surplus}) does not cover the minimum ({lotCost}). Stablecoins are usually the realistic starting point — they have the lowest entry barrier of any asset on this page.',

    'sim.q1.title':         'Will this hurt your monthly money?',
    'sim.q1.ok':            'No — your lifestyle stays exactly the same.',
    'sim.q1.tight':         'A little — keep an eye on it.',
    'sim.q1.unsafe':        'Yes — this is too much.',
    'sim.q1.detail.ok':     'After investing this amount, you would still have {buffer} left at the end of every month. That is plenty of room for a surprise expense.',
    'sim.q1.detail.tight':  'After this investment, only {buffer} would be left over each month — fine for now, but one slow month and it becomes a deficit.',
    'sim.q1.detail.unsafe': 'This is more than your spare cash — you would come up short by {gap} every month. Drop the amount before something breaks.',
    'sim.q1.detail.idle':   'Pick an amount above to see the answer.',

    'sim.q2.title':         'What could it grow into?',
    'sim.q2.detail':        'If {asset} behaves like its long-term average ({rate} per year):',
    'sim.q2.in12':          'in 12 months',
    'sim.q2.in36':          'in 3 years',
    'sim.q2.in60':          'in 5 years',
    'sim.q2.note':          'These numbers compound your monthly contribution. Real returns vary year to year.',

    'sim.q3.title':         'What is the worst case?',
    'sim.q3.detail':        'In a typical bad year, your investment of {invested} could temporarily drop to about {downside}. Long-term investors usually wait it out and recover.',
    'sim.q3.basis':         'Why we expect this:',

    /* Verdict */
    'sim.verdict.title':    'Our verdict',
    'sim.verdict.tag.go':       'Looks good — go for it',
    'sim.verdict.tag.caution':  'Doable — with care',
    'sim.verdict.tag.stop':     'Pull back first',

    /* Deficit + fallback */
    'sim.deficit.title':    'You cannot invest yet — and that is okay',
    'sim.deficit.body':     'Your statement shows you spend more than you earn each month. Investing on top of a deficit just borrows the loss forward. Close the gap on the Dashboard first — the simulator will unlock the moment you have a positive surplus.',
    'sim.deficit.cta':      'Open the Action Plan',
    'sim.fallback.eyebrow': 'Personalised capacity',
    'sim.fallback.title':   'Upload a statement to unlock the simulator',
    'sim.fallback.body':    'The simulator computes a safe-to-invest amount from your real cash flow — not a guess. Without a statement we cannot tell you how much is actually free.',
    'sim.fallback.cta':     'Go to Dashboard',
    'sim.disclaimer':       'Educational simulation only. Projections use long-run averages, not forecasts. Real returns can be higher or lower in any given year. Not financial advice.',
    'sim.proj.eyebrow':     'Projection',
    'sim.proj.title':       'How your money could grow',
    'sim.proj.sub':         'Your monthly amount compounded at the asset’s typical return, with the money you put in and a bad-month floor for context.',
    'sim.proj.value':       'Projected value',
    'sim.proj.invested':    'Money you put in',
    'sim.proj.floor':       'Bad-month floor',

    /* Sign in / Sign up */
    'auth.signin.eyebrow':  'Welcome back',
    'auth.signin.title.l1': 'Your numbers',
    'auth.signin.title.l2': 'remembered',
    'auth.signin.title.l3': 'you.',
    'auth.signin.lede':     'Sign in to pick up where you left off — every reconciliation, every category, every flagged anomaly.',
    'auth.signin.heading':  'Welcome back.',
    'auth.signin.sub':      'Pick up where you left off.',
    'auth.email':           'Email',
    'auth.password':        'Password',
    'auth.confirm':         'Confirm',
    'auth.fullName':        'Full Name',
    'auth.accountType':     'Account Type',
    'auth.accountType.personal': 'Personal',
    'auth.accountType.personalSub': 'Personal expenses & receipts',
    'auth.accountType.vendor': 'Vendor',
    'auth.accountType.vendorSub': 'Bookkeeping & reports',
    'auth.remember':        'Remember me',
    'auth.forgot':          'Forgot password?',
    'auth.signinBtn':       'Sign In',
    'auth.noAccount':       "Don't have an account?",
    'auth.signup':          'Sign up',
    'auth.continueGoogle':  'Continue with Google',
    'auth.signupGoogle':    'Sign up with Google',
    'auth.orEmail':         'or sign in with email',
    'auth.orEmailUp':       'or create with email',
    'auth.signup.eyebrow':  'Create account',
    'auth.signup.title.l1': 'Smarter money',
    'auth.signup.title.l2': 'starts',
    'auth.signup.title.l3': 'with one upload.',
    'auth.signup.lede':     'PesaLens reads your statements, balances your books, and answers questions in plain English — for individuals and SMEs across Tanzania.',
    'auth.signup.heading':  'Create your account.',
    'auth.signup.sub':      'Free for 14 days. No card.',
    'auth.signup.btn':      'Create Account',
    'auth.signup.fine':     '14-day trial · No card required · Cancel any time',
    'auth.haveAccount':     'Already have an account?',
    'auth.terms':           'I agree to the Terms of Service and Privacy Policy',

    /* Markets */
    'mk.eyebrow':           'Markets',
    'mk.title':             'Strategies & live updates',
    'mk.tagline':           'DSE · CRYPTO · S&P · FOREX',
    'mk.strategies.eyebrow': 'Strategies',
    'mk.strategies.title':  'Allocation playbooks',
    'mk.recommend':         'PesaLens recommends',
    'mk.forYou':            'For you',
    'mk.edu.eyebrow':       'Education',
    'mk.edu.title':         'Watch & learn',
    'mk.cover.eyebrow':     'Cover',
    'mk.cover.title':       'Insurance providers',
    'mk.live.eyebrow':      'Live updates',
    'mk.live.title':        'Markets pulse',
    'mk.contact':           'Contact',

    /* Bookkeeping */
    'bk.eyebrow':           'Bookkeeping',
    'bk.title':             'Daily ledger',
    'bk.tagline':           'Sales · Expenses · Debts · Receipts',
    'bk.addEntry':          'Add entry',
    'bk.scanReceipt':       'Scan receipt',
    'bk.todaySales':        "Today's sales",
    'bk.todayExpenses':     "Today's expenses",
    'bk.outstandingDebt':   'Outstanding debt',
    'bk.cashOnHand':        'Cash on hand',
    'bk.monthlyProfit':     'Monthly profit',
    'bk.month.eyebrow':     'Month',
    'bk.month.title':       'Summary',
    'bk.6m.eyebrow':        '6 months',
    'bk.6m.title':          'Revenue vs expenses',
    'bk.receipts.eyebrow':  'Receipts',
    'bk.receipts.title':    'Capture & extract',
    'bk.ledger.eyebrow':    'Ledger',
    'bk.ledger.title':      'Daily entries',
    'bk.insights.eyebrow':  'Insights',
    'bk.insights.title':    'Business intelligence',
    'bk.balanceSheet':      'Balance Sheet',
    'bk.profitLoss':        'Profit / Loss',
    'bk.takePhoto':         'Take photo',
    'bk.uploadReceipt':     'Upload receipt image',
    'bk.scanning':          'Scanning…',

    /* Personal spending */
    'pp.eyebrow':           'Personal',
    'pp.title':             'Spending',
    'pp.tagline':           'Receipts · Manual entries · Patterns',
    'pp.todayExpenses':     "Today's expenses",
    'pp.scanned':           'Receipts scanned',
    'pp.session':           'Session total',
    'pp.patternInsights':   'Pattern insights',
    'pp.capture.eyebrow':   'Capture',
    'pp.capture.title':     'Scan a receipt',
    'pp.latest.eyebrow':    'Latest',
    'pp.latest.title':      'Receipt extract',
    'pp.manual.eyebrow':    'Ledger',
    'pp.manual.title':      'Daily ledger',
    'pp.patterns.eyebrow':  'Patterns',
    'pp.patterns.title':    'Spending insights',
    'pp.gallery':           'Choose from Gallery',
    'pp.takePhoto':         'Take Photo',
    'pp.entriesEmpty':      'No manual entries yet. Click',

    /* Demo page */
    'dm.eyebrow':           'Live extraction',
    'dm.title.l1':          'Watch PesaLens',
    'dm.title.l2':          'read',
    'dm.title.l3':          'your statement.',
    'dm.lede':              'Drop a real PDF — CRDB, NMB, NBC, M-Pesa, Airtel — and see every transaction surface in seconds.',
    'dm.upload.eyebrow':    'Ingest',
    'dm.upload.title':      'Upload a statement PDF',
    'dm.upload.never':      'PDF only — never stored after extraction',
    'dm.pipeline.eyebrow':  'Pipeline',
    'dm.pipeline.title':    'Processing',
    'dm.bankDetected':      'Bank detected',
    'dm.totalDebits':       'Total debits',
    'dm.totalCredits':      'Total credits',
    'dm.running':           'running…',

    /* 404 */
    'nf.eyebrow':           'Not found',
    'nf.title.l1':          "We couldn't find",
    'nf.title.l2':          'that',
    'nf.title.l3':          'page.',
    'nf.lede':              'It may have moved, or never existed. Either way — your numbers are still here.',
    'nf.back':              'Back to home',
  },
  sw: {
    /* Navigation */
    'nav.workspace':        'Eneo Kazi',
    'nav.dashboard':        'Dashibodi',
    'nav.analysis':         'Uchambuzi',
    'nav.assistant':        'Msaidizi wa AI',
    'nav.markets':          'Soko',
    'nav.simulator':        'Kikokotoo',
    'nav.bookkeeping':      'Hesabu za Biashara',
    'nav.personal':         'Matumizi Binafsi',
    'nav.reconcile':        'Ulinganisho',
    'nav.collapse':         'Kunja',
    'nav.product':          'Bidhaa',
    'nav.startTrial':       'Anza majaribio bure',
    'nav.features':         'Vipengele',
    'nav.signin':           'Ingia',
    'nav.openAccount':      'Fungua akaunti',
    'nav.upgrade':          'Boresha',
    'nav.proTier':          'Kiwango cha Pro',
    'nav.proCopy':          'Taarifa zisizo na kikomo, muunganisho wa akaunti nyingi, tahadhari maalum.',
    'nav.trialDays':        'Siku {n} zimebaki kwa majaribio',
    'nav.trialEnded':       'Majaribio yamemalizika',
    'nav.proActive':        'Pro · inayotumika',
    'nav.search':           'Tafuta miamala, wauzaji, ufahamu…',
    'nav.profile':          'Wasifu',
    'nav.settings':         'Mipangilio',
    'nav.signout':          'Toka',
    'nav.help':             'Msaada',
    'nav.toggleTheme':      'Badilisha mandhari',
    'nav.language':         'Lugha',

    /* Common labels */
    'common.bank':          'Benki',
    'common.transactions':  'Miamala',
    'common.moneyIn':       'Pesa ndani',
    'common.moneyOut':      'Pesa nje',
    'common.netFlow':       'Mtiririko safi',
    'common.savingsRate':   'Kiwango cha akiba',
    'common.savings':       'Akiba',
    'common.expenseGrowth': 'Ukuaji wa matumizi',
    'common.incomeGrowth':  'Ukuaji wa mapato',
    'common.totalTx':       'Jumla ya miamala',
    'common.largestExp':    'Matumizi makubwa',
    'common.largestInc':    'Mapato makubwa',
    'common.avgDailySpend': 'Wastani wa matumizi ya kila siku',
    'common.date':          'Tarehe',
    'common.description':   'Maelezo',
    'common.category':      'Kategoria',
    'common.debit':         'Toleo',
    'common.credit':        'Pokeo',
    'common.balance':       'Salio',
    'common.openingBalance':'Salio la awali',
    'common.balanceNow':    'Salio sasa',
    'common.amount':        'Kiasi',
    'common.method':        'Njia',
    'common.type':          'Aina',
    'common.vendor':        'Muuzaji',
    'common.income':        'Mapato',
    'common.expense':       'Matumizi',
    'common.all':           'Yote',
    'common.search':        'Tafuta',
    'common.export':        'Hamisha',
    'common.cancel':        'Ghairi',
    'common.save':          'Hifadhi',
    'common.close':         'Funga',
    'common.previous':      'Iliyopita',
    'common.next':          'Inayofuata',
    'common.page':          'Ukurasa',
    'common.of':            'wa',
    'common.showing':       'Inaonyesha',
    'common.online':        'mtandaoni',
    'common.loading':       'inapakia',
    'common.live':          'moja kwa moja',
    'common.estimated':     'kadirio',
    'common.parsed':        'imesomwa',
    'common.locked':        '— imefungwa —',
    'common.warning':       'Onyo',
    'common.critical':      'Hatari',
    'common.notice':        'Taarifa',

    /* Landing */
    'land.eyebrow':         'Imejengwa kwa Tanzania · Kwa uwazi',
    'land.title.l1':        'Soma pesa zako',
    'land.title.like':      'kama',
    'land.title.l2':        'mhasibu wa benki anavyozisoma.',
    'land.lede':            'PesaLens hubadilisha taarifa yoyote ya benki — CRDB, NMB, NBC, M-Pesa, Airtel — kuwa daftari safi la kila shilingi, kisha hukutembeza ndani yake kama afisa wa fedha angefanya. Bila lahajedwali.',
    'land.tryDemo':         'Anza majaribio ya siku 14 bure',
    'land.openFree':        'Fungua akaunti ya bure',
    'land.startTrial':      'Anza majaribio ya siku 14 bure',
    'land.systemOk':        'Mfumo unafanya kazi',
    'land.trial':           'Jaribio la siku 14 · bila kadi',
    'land.soc2':            'Salama wakati wa kusafirishwa (HTTPS)',
    'land.encryption':      'Taarifa zako haziuziwi tena',
    'land.heroLabel':       'Mtiririko safi mwezi huu',
    'land.heroSub':         'taarifa · moja kwa moja',
    'land.method.eyebrow':  'Mbinu',
    'land.method.title.l1': 'Taarifa ndani.',
    'land.method.title.l2': 'Uwazi',
    'land.method.title.l3': 'nje.',
    'land.method.lede':     'Hatua tatu zilizo wazi. Hakuna kuingiza data, hakuna lahajedwali, hakuna kuhamisha kwenda dashibodi ya kawaida usiyoifungua tena.',
    'land.step.ingest':     'Ingiza',
    'land.step.reconcile':  'Linganisha',
    'land.step.decide':     'Amua',
    'land.step.1.title':    'Dondosha taarifa',
    'land.step.1.desc':     'PDF kutoka CRDB, NMB, NBC, Stanbic, M-Pesa, Airtel Money — hata picha za kurasa.',
    'land.step.2.title':    'Tunasoma kila mstari',
    'land.step.2.desc':     'OCR pamoja na mantiki ya daftari hutoa kila muamala, kuiainisha, na kulinganisha na salio la mwisho.',
    'land.step.3.title':    'Uliza, linganisha, tenda',
    'land.step.3.desc':     'KPI, hitilafu, ada zilizofichika, kiwango cha akiba, na msaidizi wa AI unayemwuliza kwa lugha ya kawaida.',
    'land.cap.eyebrow':     'Uwezo',
    'land.cap.title.l1':    'Eneo moja la kazi.',
    'land.cap.title.l2':    'Kila',
    'land.cap.title.l3':    'swali la fedha.',
    'land.cap.lede':        'Kila moduli imejengwa kwa kazi yake — siyo nakala kutoka kiolezo. Tumia dakika tano; utahisi tofauti.',
    'land.why.eyebrow':     'Kwa nini PesaLens',
    'land.why.title.l1':    'Acha kusoma taarifa za benki',
    'land.why.title.l2':    'kwa mkono.',
    'land.why.lede':        'Iwapo wewe ni mtu binafsi unayefuatilia mboga au muuzaji unayefunga vitabu mwisho wa siku — PesaLens hubadilisha folda ya PDF na mwonekano mmoja unaolinganishwa kila wakati wa pesa zako.',
    'land.cta.eyebrow':     'Anza',
    'land.cta.title.l1':    'Fungua PesaLens.',
    'land.cta.title.l2':    'Pakia taarifa moja.',
    'land.cta.lede':        'Jaribio la bure la siku 14. Bila kadi. Tutakuwa na nambari zako zikiongea nawe ndani ya dakika moja.',
    'land.cta.tryFirst':    'Anza majaribio ya siku 14',
    'land.cta.create':      'Fungua akaunti ya bure',
    'land.cta.fine':        'Salama wakati wa kusafirishwa · Taarifa haziuziwi · Futa data wakati wowote',
    'foot.product':         'Bidhaa',
    'foot.company':         'Kampuni',
    'foot.legal':           'Kisheria',
    'foot.tag':             'Akili ya kifedha kwa watu binafsi na biashara ndogo Tanzania.',
    'foot.copy':            '© 2026 PesaLens · Haki zote zimehifadhiwa',
    'foot.built':           'Imejengwa Tanzania',

    /* Dashboard */
    'dash.eyebrow':         'Dashibodi',
    'dash.welcome':         'Karibu PesaLens.',
    'dash.welcomeSub':      'Pakia taarifa yako ya kwanza ya benki na sisi tutafanya mengine — utoaji, uainishaji, ukaguzi wa salio, uchambuzi wa ada.',
    'dash.uploadAnother':   'Pakia nyingine',
    'dash.uploading':       'Inapakia…',
    'dash.upload.eyebrow':  'Ingiza',
    'dash.upload.title':    'Pakia taarifa ya benki',
    'dash.upload.subtitle': 'PDF · upeo 50MB',
    'dash.upload.drop':     'Dondosha taarifa yako hapa, au bofya kuvinjari',
    'dash.upload.banks':    'CRDB · NMB · NBC · Stanbic · M-Pesa · Airtel Money',
    'dash.upload.ready':    'tayari',
    'dash.upload.extract':  'Toa miamala',
    'dash.upload.extracting': 'Inatoa…',
    'dash.empty.title':     'Hakuna kitu cha kuonesha bado',
    'dash.empty.desc':      'Ukipakia, kila muamala husomwa, kuainishwa, na kulinganishwa. Baada ya taarifa tatu, KPI zako za mwelekeo hufunguliwa.',
    'dash.fee.eyebrow':     'Uvujaji wa ada',
    'dash.fee.occurrences': 'matukio',
    'dash.recon.eyebrow':   'Ulinganishaji',
    'dash.recon.balance':   'ukaguzi wa salio',
    'dash.recon.closing':   'Salio la kufunga',
    'dash.recon.computed':  'Kilichohesabiwa (ndani − nje)',
    'dash.recon.discrepancy': 'Tofauti',
    'dash.anom.eyebrow':    'Hitilafu',
    'dash.anom.flagged':    'imeashiriwa',
    'dash.cf.eyebrow':      'Mtiririko wa pesa',
    'dash.cf.title':        'Mapato dhidi ya matumizi',
    'dash.mix.eyebrow':     'Mchanganyiko',
    'dash.mix.title':       'Mgawanyiko wa matumizi',
    'dash.mix.total':       'Jumla',
    'dash.lockedHint':      'taarifa zaidi ili kufungua',
    'dash.lockedHint.p':    'taarifa zaidi ili kufungua',

    /* Analysis */
    'an.eyebrow':           'Uchambuzi',
    'an.title':             'Mchanganuo wa taarifa',
    'an.mix.eyebrow':       'Mchanganyiko',
    'an.mix.title':         'Matumizi kwa kategoria',
    'an.top.eyebrow':       'Kategoria za juu',
    'an.top.title':         'Pesa zinakwenda wapi',
    'an.cat.viewTx':        'Tazama miamala',
    'an.cat.empty':         'Hakuna miamala katika kategoria hii.',
    'an.search':            'Tafuta miamala, kategoria…',
    'an.sort.latest':       'Mpya zaidi kwanza',
    'an.sort.oldest':       'Za zamani kwanza',
    'an.sort.dh':           'Toleo: juu → chini',
    'an.sort.dl':           'Toleo: chini → juu',
    'an.sort.ch':           'Pokeo: juu → chini',
    'an.sort.cl':           'Pokeo: chini → juu',
    'an.uncategorized':     'Bila kategoria',
    'an.empty.title':       'Hakuna taarifa ya kuchambua',
    'an.empty.desc':        'Pakia taarifa ya benki kwenye Dashibodi kuona mchanganuo hapa.',
    'an.tx.detail':         'Maelezo ya muamala',
    'an.reference':         'Marejeo',
    'an.pageNo':            'Ukurasa',

    /* Assistant */
    'ai.title':             'PesaLens AI',
    'ai.subtitle':          'imeandaliwa juu ya taarifa yako',
    'ai.placeholder':       'Uliza kuhusu fedha zako…',
    'ai.welcome':           'Karibu kwenye Msaidizi wa PesaLens AI. Pakia taarifa yako ya benki kwenye Dashibodi kama bado, kisha uniulize chochote — naweza kueleza mifumo ya matumizi, kuonyesha fursa za kuokoa, na kupitia miamala mahususi.',
    'ai.suggest.1':         'Eleza matumizi yangu makubwa mwezi huu',
    'ai.suggest.2':         'Naweza vipi kupunguza matumizi yasiyo ya lazima?',
    'ai.suggest.3':         'Ni kategoria zipi zilizotumia pesa nyingi?',
    'ai.suggest.4':         'Ni mkakati gani wa uwekezaji unaolingana na mtiririko wangu?',
    'ai.snapshot.eyebrow':  'Taarifa',
    'ai.snapshot.title':    'Picha kwa ujumla',
    'ai.spending.eyebrow':  'Matumizi',
    'ai.spending.title':    'Kategoria za juu',
    'ai.anom.eyebrow':      'Hitilafu',
    'ai.anom.title':        'Zilizoashiriwa',
    'ai.anom.empty':        'Hakuna ilichoashiriwa kwenye taarifa ya hivi karibuni.',
    'ai.snapshot.empty':    'Hakuna taarifa iliyopakiwa.',
    'ai.spending.empty':    'Pakia taarifa kuona kategoria.',
    'ai.hello':             'Habari, {name}',
    'ai.howHelp':           'Nikusaidie vipi na fedha zako leo?',
    'ai.explore':           'Ungependa kuchunguza nini?',
    'ai.send':              'Tuma',
    'ai.export':            'Hamisha mazungumzo',
    'ai.copied':            'Imenakiliwa',
    'ai.flagged':           'zimeashiriwa',
    'ai.card.statement':    'Nipe muhtasari wa lugha rahisi wa taarifa yangu ya hivi karibuni.',
    'ai.card.spending':     'Ni kategoria zipi zilizotumia pesa nyingi, na kwa nini?',
    'ai.card.anomalies':    'Eleza hitilafu zilizoashiriwa kwenye taarifa yangu na jinsi ya kuzirekebisha.',

    /* Markets — Ask the Advisor (chat panel) */
    'mki.eyebrow':          'Uliza Mshauri wa Soko',
    'mki.heading':          'PesaLens AI · hisa {dse} · sarafu {fx} · cryptos {coins}',
    'mki.sub':              'Majibu ya kielimu kwa Kiingereza / Kiswahili — siyo amri ya kununua/kuuza.',
    'mki.badge':            'Muktadha hai',
    'mki.try':              'Jaribu mojawapo ya haya:',
    'mki.placeholder':      'Uliza kuhusu TZS, mafuta, DSE, crypto…',
    'mki.ask':              'Uliza',
    'mki.retry':            'Jaribu tena',
    'mki.offline.title':    'Mshauri wa AI hayuko sasa',
    'mki.offline.body':     'Data ya soko iko sawa lakini mfumo wa lugha haujasanidiwa kwenye seva. Weka GEMINI_API_KEY au OPENROUTER_API_KEY kwenye .env ya backend ili kuwasha maelezo binafsi. Muktadha hapo juu bado ni sahihi.',
    'mki.error.generic':    'Imeshindwa kumfikia mshauri.',
    'mki.error.network':    'Tatizo la mtandao — backend yako haifikiki kutoka kifaa hiki.',
    'mki.error.unauth':     'Kipindi chako kimeisha. Ingia tena kumuuliza mshauri.',
    'mki.error.plan':       'Majaribio yako yamekwisha. Boresha ili kuendelea kuuliza mshauri.',
    'mki.quick.1':          'Kwa nini Shilingi ya Tanzania ni dhaifu kuliko dola?',
    'mki.quick.2':          'Niweke akiba katika TZS au USD sasa hivi?',
    'mki.quick.3':          'DSE inalinganishwaje na S&P 500?',
    'mki.quick.4':          'Polymarket inatuambia nini kuhusu hisia za dunia?',
    'mki.quick.5':          'Kwa nini bei ya mafuta ya EWURA hubadilika kila mwezi?',

    /* Action engine */
    'act.eyebrow':          'Injini ya hatua',
    'act.title':            'Cha kubadilisha hasa — kulingana na taarifa yako',
    'act.lede':             'Sehemu tatu, zote zimebinafsishwa kwa nambari zako. Soma kuanzia juu: kinachovuja, unachoweza kuchukua, kisha cha kufanya kwa siku 30 zijazo.',
    'act.badge':            'Maamuzi, siyo data',
    'act.kpi.surplus':      'Pesa za ziada kila mwezi',
    'act.kpi.savings':      'Kiwango cha akiba',
    'act.kpi.savings.bench':'(20% ni nzuri)',
    'act.kpi.mistakes':     'Mahali pa kuvuja',
    'act.kpi.wins':         'Fursa zinazongoja',

    /* Hero */
    'act.hero.healthy':     'Taarifa yako inaonekana nzuri. Hapa chini kuna fursa unazoweza kuchukua na mpango wa siku 30 wa kuendeleza kasi.',
    'act.hero.deficit':     'Unatumia zaidi ya unayopata kila mwezi. Suluhisho kubwa ni hapa chini — anzia hapo kabla ya jambo lingine lolote.',
    'act.hero.tight':       'Kiwango chako cha akiba ni chini ya 20% — unaacha pesa mezani. Marekebisho hapa chini yanafanya tofauti halisi ndani ya mwezi mmoja.',
    'act.hero.strong':      'Una pesa za ziada na kiwango cha akiba kilicho nzuri — fursa kubwa hapa chini ni kuhusu kufanya pesa hizo zifanye kazi, siyo tu kuziweka.',

    /* Section headers */
    'act.section.mistakes.title': 'Kinachovuja pesa zako',
    'act.section.mistakes.lede':  'Kila kipengee hapa chini kinakugharimu shilingi halisi kila mwezi. Rekebisha cha juu kwanza — kina manufaa makubwa zaidi.',
    'act.section.opps.title':     'Fursa unazoweza kuchukua',
    'act.section.opps.lede':      'Pesa halisi unazoweza kuelekeza au kupata — bila kufanya kazi zaidi. Chagua moja na uchukue hatua wiki hii.',
    'act.section.plan.title':     'Mpango wako wa siku 30',
    'act.section.plan.lede':      'Hatua halisi kwa mpangilio sahihi. Kila moja ina ukubwa unaowezekana bila kuvuruga maisha yako.',

    /* Card chrome */
    'act.fix.label':        'Jinsi ya kurekebisha',
    'act.win.label':        'Jinsi ya kuichukua',
    'act.cost.monthly':     'kwa mwezi',
    'act.gain.year':        'inaweza kupatikana kwa mwaka',
    'act.opps.potential':   'inaweza kupatikana',

    'act.empty.mistakes':   'Hakuna lililotambuliwa — taarifa hii inaonekana safi.',
    'act.empty.opps':       'Hakuna fursa zilizojitokeza bado — pakia mwezi mwingine ili tuone mifumo.',

    /* CTA */
    'act.cta.title':        'Inayofuata — fanya pesa hizi zikue',
    'act.cta.body':         'Mara tu unapokamata mojawapo ya fursa hapo juu, nenda kwenye mfano wa Soko. Unaonyesha hasa kiasi cha ziada unachoweza kuwekeza bila kugusa maisha yako ya kila siku.',
    'act.cta.button':       'Fungua mfano',

    /* Investment simulator — three-step decision wizard */
    'sim.eyebrow':          'Pesa zako × soko',
    'sim.title':            'Naweza kuwekeza? Na ikiwa ndio, vipi — bila kuvuruga mwezi wangu?',
    'sim.lede':             'Mwongozo wa hatua tatu uliojengwa kutoka taarifa yako mwenyewe. Bila lugha ngumu, bila shinikizo — nambari tu zinazoeleweka.',
    'sim.badge':            'Imebinafsishwa',

    /* Kichwa cha ukurasa wa Kikokotoo */
    'sim.page.eyebrow':     'Kikokotoo',
    'sim.page.title':       'Panga uwekezaji wako wa kwanza',
    'sim.page.desc':        'Geuza taarifa yako kuwa uamuzi — kiasi unachoweza kuwekeza salama kila mwezi, wapi pa kukiweka, na kinachoweza kuwa.',

    /* Hero */
    'sim.hero.eyebrow':     'Mwanzo wako',
    'sim.hero.title':       'Unaweza kuwekeza kwa starehe takriban',
    'sim.hero.subtitle':    'kila mwezi — bila kugusa maisha yako.',
    'sim.hero.explainer':   'Hii ni 15% ya ziada yako ya mwezi (kilichobaki baada ya matumizi). Watu wengi huanza hapa — kubwa kutosha kukua, ndogo kutosha kutoumiza ikiwa bili itajitokeza ghafla.',
    'sim.hero.surplus':     'Unapata',
    'sim.hero.spend':       'Unatumia',
    'sim.hero.left':        'Umebakiwa',

    /* Step 1 */
    'sim.step1.eyebrow':    'Hatua 1',
    'sim.step1.title':      'Utaweka kiasi gani kila mwezi?',
    'sim.step1.lede':       'Chagua kiwango kinachokufaa. Hiki ndicho utakachowekeza kila mwezi kuanzia sasa.',
    'sim.step1.recommend':  'Tunakupendekezea',
    'sim.step1.recommend.tail': 'Unaweza kubadilisha wakati wowote.',
    'sim.tier.safe.title':         'Tia kidole tu',
    'sim.tier.moderate.title':     'Jenga tabia',
    'sim.tier.aggressive.title':   'Nenda zaidi',
    'sim.tier.safe.short':         '5% ya pesa zako za ziada',
    'sim.tier.moderate.short':     '15% ya pesa zako za ziada',
    'sim.tier.aggressive.short':   '30% ya pesa zako za ziada',
    'sim.tier.safe.bestFor':       'Bora ikiwa ni mara yako ya kwanza kuwekeza au mapato yako hubadilika kila mwezi. Hutahisi kabisa zinatoka kwenye akaunti yako.',
    'sim.tier.moderate.bestFor':   'Bora ikiwa mapato yako ni thabiti na tayari una akiba kidogo. Watu wengi huishia hapa.',
    'sim.tier.aggressive.bestFor': 'Bora ikiwa tayari una akiba ya dharura na uko sawa na mabadiliko makubwa. Hifadhi kwa baadaye ikiwa huna uhakika.',

    /* Recommend reasons */
    'sim.recommend.safe.tiny':         'Ziada yako ya mwezi ni ndogo kwa sasa — anza kiwango salama ili tabia ijengeke bila shinikizo. Unaweza kuongeza baadaye.',
    'sim.recommend.safe.unsteady':     'Kiwango chako cha akiba bado kinaongezeka — ngazi salama hukuwezesha kuwekeza bila kuweka shinikizo kwa mwezi ujao.',
    'sim.recommend.moderate.steady':   'Mtiririko wako ni thabiti na akiba yako ni nzuri — kiwango cha wastani ni bora kwa kujenga utajiri thabiti.',
    'sim.recommend.aggressive.headroom':'Una ziada kubwa na akiba nzuri — unaweza kushinikiza zaidi ikiwa unataka.',

    /* Step 2 */
    'sim.step2.eyebrow':    'Hatua 2',
    'sim.step2.title':      'Pesa zitaenda wapi?',
    'sim.step2.lede':       'Kila chaguo lina ukuaji tofauti na hatari tofauti. Chagua linalokufaa zaidi kuhusiana na jinsi unavyovumilia mabadiliko.',
    'sim.cat.stocks.title':   'Hisa za Tanzania (DSE)',
    'sim.cat.stocks.body':    'Nunua sehemu ndogo ya kampuni halisi ya Tanzania. Unapata sehemu ya faida na ukuaji wake.',
    'sim.cat.stocks.bestFor': 'Utajiri wa muda mrefu, kwa Tanzania.',
    'sim.cat.stable.title':   'Sarafu Thabiti za USD',
    'sim.cat.stable.body':    'Sarafu za kidijitali zinazoshikilia thamani ya dola ya Marekani. Kama akaunti ya akiba kwa dola — inakulinda dhidi ya kupungua kwa TZS.',
    'sim.cat.stable.bestFor': 'Kuhifadhi thamani, siyo ukuaji mkubwa.',
    'sim.cat.crypto.title':   'Sarafu za Kidijitali (Bitcoin / Ethereum n.k.)',
    'sim.cat.crypto.body':    'Sarafu za kidijitali zinazobadilika sana — uwezekano mkubwa wa ukuaji, hatari kubwa. Wekeza tu unachoweza kupoteza kwa miaka.',
    'sim.cat.crypto.bestFor': 'Hatari kubwa, faida kubwa, muda mrefu.',
    'sim.cat.typicalReturn': 'Ukuaji wa kawaida wa mwaka',
    'sim.cat.typicalRisk':   'Mabadiliko ya kawaida ya muda mfupi',
    'sim.cat.pickAsset':     'Chagua mali maalum',
    'sim.cat.empty':         'Hakuna mali katika kategoria hii — jaribu nyingine.',
    'sim.cat.showAll':       'Onyesha zote',
    'sim.cat.showLess':      'Onyesha chache',

    'sim.risk.suffix':      'hatari',
    'sim.risk.Low':         'Chini',
    'sim.risk.Medium':      'Wastani',
    'sim.risk.High':        'Juu',
    'sim.risk.Extreme':     'Kubwa sana',

    /* Step 3 */
    'sim.step3.eyebrow':    'Hatua 3',
    'sim.step3.title':      'Kwa hivyo nini hasa kinatokea ukifanya hivi?',
    'sim.step3.lede':       'Majibu matatu ya kweli, kulingana na kiasi na mali ulivyochagua hapo juu.',

    /* Mchanganuo wa ununuzi — idadi pamoja na ushauri pesa zikiwa kidogo */
    'sim.buy.title':        'Idadi unayoweza kununua kwa kiasi hiki',
    'sim.buy.budget':       'Bajeti yako ya mwezi',
    'sim.buy.price':        'Bei ya mali',
    'sim.buy.canBuy':       'Unaweza kununua',
    'sim.buy.howTo':        'Jinsi ya kuhifadhi thamani ya kutosha kuanza',

    /* DSE — hisa za Tanzania */
    'sim.buy.dse.ok.head':   'Unaweza kununua hisa {units} za {symbol} mwezi huu.',
    'sim.buy.dse.ok.body':   'Hii inatumia {cost} ya mgao wako wa mwezi, na kuacha {leftover} bila kufanya kazi. Rudia ununuzi huo kila mwezi na kiasi chako kitakua hatua kwa hatua.',
    'sim.buy.dse.ok.note':   'Hisa za DSE huuzwa kwa fungu la 10. Fungu moja la hisa hii linagharimu {lotCost}.',
    'sim.buy.dse.short.head':'Fungu moja ni hisa {lotQty} za {symbol} — linagharimu {lotCost}. Mgao wako wa sasa haufiki hapo bado.',
    'sim.buy.dse.short.body':'Unapungukiwa na {shortfall}. DSE hairuhusu kununua chini ya hisa 10, kwa hivyo {cash} kwa mwezi inakaa kama pesa taslimu hadi ufikie bei ya fungu.',

    /* CRYPTO — Bitcoin / Ethereum / altcoin */
    'sim.buy.crypto.ok.head':   'Unaweza kununua takriban {units} {symbol} mwezi huu.',
    'sim.buy.crypto.ok.body':   'Hii inatumia {cost} ya mgao wako. Sarafu za kidijitali zinanunuliwa kwa sehemu — kila shilingi juu ya kiwango cha chini cha exchange inanunua sehemu ya {symbol}, hauhitaji sarafu nzima.',
    'sim.buy.crypto.ok.note':   'Exchange nyingi (Binance P2P, KuCoin, Yellow Card) hazikubali oda chini ya takriban {lotCost} (~$1 USD). Wewe uko juu ya kiwango hicho.',
    'sim.buy.crypto.short.head':'Exchange nyingi za sarafu za kidijitali zina kiwango cha chini cha oda kuhusu {lotCost} (≈ $1 USD). Chini ya hapo oda inakataliwa hata ingawa {symbol} inanunuliwa kwa sehemu.',
    'sim.buy.crypto.short.body':'Unapungukiwa na {shortfall} kufikia kiwango cha kweli. {cash} kwa mwezi inakaa kama pesa taslimu — exchange haitaweka oda hadi ufikie kiwango cha chini.',

    /* STABLE — USDT / USDC / DAI */
    'sim.buy.stable.ok.head':   'Unaweza kununua tokeni {units} za {symbol} mwezi huu.',
    'sim.buy.stable.ok.body':   '{symbol} imefungwa kwa dola ya Marekani, kwa hivyo kila tokeni ina thamani ya ≈ $1. {cost} ya mgao wako inanunua tokeni nzima; {leftover} inabaki kama TZS.',
    'sim.buy.stable.ok.note':   'Tokeni moja ya {symbol} inagharimu takriban {lotCost} kwa kiwango cha leo.',
    'sim.buy.stable.short.head':'Tokeni moja ya {symbol} inagharimu takriban {lotCost} (≈ $1 USD). Mgao wako wa sasa haufiki tokeni moja kamili.',
    'sim.buy.stable.short.body':'Unapungukiwa na {shortfall}. Wauzaji wa P2P hawauzi chini ya 1 USDT/USDC, kwa hivyo {cash} kwa mwezi inakaa kama pesa taslimu hadi uweze kupata tokeni moja.',

    /* Mistari ya kawaida ya "jinsi ya kurekebisha" */
    'sim.buy.fix.save':     'Endelea na mgao huo huo kwa miezi {months} — utakuwa umeokoa kutosha ({months} × {cash} ≥ {lotCost}). Hifadhi pesa kwenye akaunti ya akiba au sarafu thabiti ili izalishe kidogo unapongoja.',
    'sim.buy.fix.upgrade':  'Hamia ngazi ya {tier} ({cash}/mwezi) — kuongeza huko kunakuweka kwenye kiwango cha chini mwezi huu huu.',
    'sim.buy.fix.upgrade.cta': 'Tumia ngazi hii',
    'sim.buy.fix.cheaper':  'Chagua hisa nyingine ya DSE iliyo nafuu — kwa mfano {cheaperSymbol}, ambapo fungu moja ni {cheaperLot}. Soko lile lile, broker yule yule, tikiti ndogo tu.',
    'sim.buy.fix.cheaper.cta': 'Hamia {symbol}',
    'sim.buy.fix.stableSwap':  'Hamia kwenye sarafu thabiti — {stableSymbol} inagharimu takriban {stableLot} kwa tokeni (≈ $1 USD), kwa hivyo mgao wowote chanya unanunua angalau tokeni moja kamili. Mabadiliko madogo, njia zilezile za crypto.',
    'sim.buy.fix.stableSwap.cta': 'Hamia {symbol}',
    'sim.buy.fix.trim':     'Achilia {shortfall} kutoka kategoria nyingine (Mpango wa Hatua unaonyesha vipunguzo rahisi). Ziada yako ikikaribia kiwango cha chini, kusubiri kunapungua.',
    'sim.buy.fix.tooSmall': 'Hata ziada yako yote ya mwezi ({surplus}) haifiki kiwango cha chini ({lotCost}). Sarafu thabiti kwa kawaida ndizo mahali pa kuanzia — zina kiwango cha chini cha kuingia kuliko mali yoyote nyingine kwenye ukurasa huu.',

    'sim.q1.title':         'Je, hii itaumiza pesa zako za mwezi?',
    'sim.q1.ok':            'Hapana — maisha yako yatabaki kama yalivyo.',
    'sim.q1.tight':         'Kidogo — angalia kwa makini.',
    'sim.q1.unsafe':        'Ndio — hii ni kubwa sana.',
    'sim.q1.detail.ok':     'Baada ya kuwekeza kiasi hiki, bado utabakiwa na {buffer} mwisho wa kila mwezi. Hiyo ni nafasi ya kutosha kwa gharama za ghafla.',
    'sim.q1.detail.tight':  'Baada ya uwekezaji huu, ni {buffer} tu utakaobaki kila mwezi — sawa kwa sasa, lakini mwezi mmoja wa polepole na inakuwa upungufu.',
    'sim.q1.detail.unsafe': 'Hii ni zaidi ya pesa zako za ziada — utakuwa pungufu kwa {gap} kila mwezi. Punguza kiasi kabla ya kitu kuvunjika.',
    'sim.q1.detail.idle':   'Chagua kiasi hapo juu kuona jibu.',

    'sim.q2.title':         'Inaweza kukua kuwa nini?',
    'sim.q2.detail':        'Ikiwa {asset} itafanya kama wastani wake wa muda mrefu ({rate} kwa mwaka):',
    'sim.q2.in12':          'kwa miezi 12',
    'sim.q2.in36':          'kwa miaka 3',
    'sim.q2.in60':          'kwa miaka 5',
    'sim.q2.note':          'Nambari hizi huzidisha mchango wako wa kila mwezi. Faida halisi hutofautiana kila mwaka.',

    'sim.q3.title':         'Hali mbaya zaidi ni nini?',
    'sim.q3.detail':        'Katika mwaka mbaya wa kawaida, uwekezaji wako wa {invested} unaweza kushuka kwa muda hadi takriban {downside}. Wawekezaji wa muda mrefu hubaki na kupona.',
    'sim.q3.basis':         'Kwa nini tunatarajia hivi:',

    /* Verdict */
    'sim.verdict.title':    'Hukumu yetu',
    'sim.verdict.tag.go':       'Inaonekana sawa — fanya',
    'sim.verdict.tag.caution':  'Inawezekana — kwa makini',
    'sim.verdict.tag.stop':     'Punguza kwanza',

    /* Deficit + fallback */
    'sim.deficit.title':    'Huwezi kuwekeza bado — na hilo ni sawa',
    'sim.deficit.body':     'Taarifa yako inaonyesha unatumia zaidi ya unayopata kila mwezi. Kuwekeza juu ya upungufu ni kuhamisha hasara mbele tu. Funga pengo kwanza kwenye Dashibodi — mfano utafunguka mara tu utakapokuwa na ziada chanya.',
    'sim.deficit.cta':      'Fungua Mpango wa Hatua',
    'sim.fallback.eyebrow': 'Uwezo binafsi',
    'sim.fallback.title':   'Pakia taarifa kufungua mfano',
    'sim.fallback.body':    'Mfano huhesabu kiasi salama cha kuwekeza kutoka mtiririko wako halisi — siyo nadhani. Bila taarifa hatuwezi kukuambia kiasi gani kipo huru.',
    'sim.fallback.cta':     'Nenda Dashibodi',
    'sim.disclaimer':       'Mfano wa kielimu pekee. Makadirio yanatumia wastani wa muda mrefu, siyo utabiri. Faida halisi inaweza kuwa kubwa au ndogo zaidi kwa mwaka wowote. Siyo ushauri wa kifedha.',
    'sim.proj.eyebrow':     'Makadirio',
    'sim.proj.title':       'Jinsi pesa yako inavyoweza kukua',
    'sim.proj.sub':         'Kiasi chako cha kila mwezi kikikua kwa faida ya kawaida ya mali, pamoja na pesa uliyoweka na kiwango cha chini cha mwezi mbaya.',
    'sim.proj.value':       'Thamani inayotarajiwa',
    'sim.proj.invested':    'Pesa uliyoweka',
    'sim.proj.floor':       'Kiwango cha mwezi mbaya',

    /* Sign in / Sign up */
    'auth.signin.eyebrow':  'Karibu tena',
    'auth.signin.title.l1': 'Nambari zako',
    'auth.signin.title.l2': 'zinakukumbuka',
    'auth.signin.title.l3': 'wewe.',
    'auth.signin.lede':     'Ingia kuendeleza pale ulipoachia — kila ulinganishaji, kila kategoria, kila hitilafu iliyoashiriwa.',
    'auth.signin.heading':  'Karibu tena.',
    'auth.signin.sub':      'Endeleza pale ulipoachia.',
    'auth.email':           'Barua pepe',
    'auth.password':        'Nenosiri',
    'auth.confirm':         'Thibitisha',
    'auth.fullName':        'Jina kamili',
    'auth.accountType':     'Aina ya akaunti',
    'auth.accountType.personal': 'Binafsi',
    'auth.accountType.personalSub': 'Matumizi binafsi & risiti',
    'auth.accountType.vendor': 'Muuzaji',
    'auth.accountType.vendorSub': 'Hesabu & ripoti',
    'auth.remember':        'Nikumbuke',
    'auth.forgot':          'Umesahau nenosiri?',
    'auth.signinBtn':       'Ingia',
    'auth.noAccount':       'Huna akaunti?',
    'auth.signup':          'Jisajili',
    'auth.continueGoogle':  'Endelea na Google',
    'auth.signupGoogle':    'Jisajili na Google',
    'auth.orEmail':         'au ingia kwa barua pepe',
    'auth.orEmailUp':       'au tengeneza kwa barua pepe',
    'auth.signup.eyebrow':  'Tengeneza akaunti',
    'auth.signup.title.l1': 'Pesa nadhifu zaidi',
    'auth.signup.title.l2': 'huanza',
    'auth.signup.title.l3': 'na upakiaji mmoja.',
    'auth.signup.lede':     'PesaLens husoma taarifa zako, hupanga vitabu vyako, na hujibu maswali kwa lugha ya kawaida — kwa watu binafsi na biashara ndogo Tanzania.',
    'auth.signup.heading':  'Tengeneza akaunti yako.',
    'auth.signup.sub':      'Bure kwa siku 14. Bila kadi.',
    'auth.signup.btn':      'Tengeneza Akaunti',
    'auth.signup.fine':     'Jaribio la siku 14 · Bila kadi · Ghairi wakati wowote',
    'auth.haveAccount':     'Tayari una akaunti?',
    'auth.terms':           'Nakubali Masharti ya Huduma na Sera ya Faragha',

    /* Markets */
    'mk.eyebrow':           'Soko',
    'mk.title':             'Mikakati & taarifa za moja kwa moja',
    'mk.tagline':           'DSE · CRYPTO · S&P · FOREX',
    'mk.strategies.eyebrow': 'Mikakati',
    'mk.strategies.title':  'Vitabu vya ugawaji',
    'mk.recommend':         'PesaLens inapendekeza',
    'mk.forYou':            'Kwa ajili yako',
    'mk.edu.eyebrow':       'Elimu',
    'mk.edu.title':         'Tazama na ujifunze',
    'mk.cover.eyebrow':     'Bima',
    'mk.cover.title':       'Watoa huduma za bima',
    'mk.live.eyebrow':      'Taarifa za moja kwa moja',
    'mk.live.title':        'Mwendo wa soko',
    'mk.contact':           'Wasiliana',

    /* Bookkeeping */
    'bk.eyebrow':           'Hesabu',
    'bk.title':             'Daftari la kila siku',
    'bk.tagline':           'Mauzo · Matumizi · Madeni · Risiti',
    'bk.addEntry':          'Ongeza ingizo',
    'bk.scanReceipt':       'Skani risiti',
    'bk.todaySales':        'Mauzo ya leo',
    'bk.todayExpenses':     'Matumizi ya leo',
    'bk.outstandingDebt':   'Deni lililobaki',
    'bk.cashOnHand':        'Pesa mkononi',
    'bk.monthlyProfit':     'Faida ya mwezi',
    'bk.month.eyebrow':     'Mwezi',
    'bk.month.title':       'Muhtasari',
    'bk.6m.eyebrow':        'Miezi 6',
    'bk.6m.title':          'Mapato dhidi ya matumizi',
    'bk.receipts.eyebrow':  'Risiti',
    'bk.receipts.title':    'Nasa & toa',
    'bk.ledger.eyebrow':    'Daftari',
    'bk.ledger.title':      'Maingizo ya kila siku',
    'bk.insights.eyebrow':  'Ufahamu',
    'bk.insights.title':    'Akili ya biashara',
    'bk.balanceSheet':      'Karatasi ya Salio',
    'bk.profitLoss':        'Faida / Hasara',
    'bk.takePhoto':         'Piga picha',
    'bk.uploadReceipt':     'Pakia picha ya risiti',
    'bk.scanning':          'Inaskani…',

    /* Personal */
    'pp.eyebrow':           'Binafsi',
    'pp.title':             'Matumizi',
    'pp.tagline':           'Risiti · Maingizo ya mkono · Mifumo',
    'pp.todayExpenses':     'Matumizi ya leo',
    'pp.scanned':           'Risiti zilizoskaniwa',
    'pp.session':           'Jumla ya kipindi',
    'pp.patternInsights':   'Ufahamu wa mifumo',
    'pp.capture.eyebrow':   'Nasa',
    'pp.capture.title':     'Skani risiti',
    'pp.latest.eyebrow':    'Mpya',
    'pp.latest.title':      'Maelezo ya risiti',
    'pp.manual.eyebrow':    'Daftari',
    'pp.manual.title':      'Daftari la siku',
    'pp.patterns.eyebrow':  'Mifumo',
    'pp.patterns.title':    'Ufahamu wa matumizi',
    'pp.gallery':           'Chagua kutoka Galleri',
    'pp.takePhoto':         'Piga Picha',
    'pp.entriesEmpty':      'Hakuna maingizo bado. Bofya',

    /* Demo */
    'dm.eyebrow':           'Utoaji wa moja kwa moja',
    'dm.title.l1':          'Tazama PesaLens',
    'dm.title.l2':          'ikisoma',
    'dm.title.l3':          'taarifa yako.',
    'dm.lede':              'Dondosha PDF halisi — CRDB, NMB, NBC, M-Pesa, Airtel — uone kila muamala ukijitokeza ndani ya sekunde chache.',
    'dm.upload.eyebrow':    'Ingiza',
    'dm.upload.title':      'Pakia PDF ya taarifa',
    'dm.upload.never':      'PDF tu — haihifadhiwi baada ya kutolewa',
    'dm.pipeline.eyebrow':  'Mfumo',
    'dm.pipeline.title':    'Inachakata',
    'dm.bankDetected':      'Benki iliyotambuliwa',
    'dm.totalDebits':       'Jumla ya matoleo',
    'dm.totalCredits':      'Jumla ya mapokeo',
    'dm.running':           'inaendelea…',

    /* 404 */
    'nf.eyebrow':           'Haipo',
    'nf.title.l1':          'Hatukuweza kupata',
    'nf.title.l2':          'ukurasa',
    'nf.title.l3':          'huo.',
    'nf.lede':              'Huenda umehama, au haukuwepo. Kwa vyovyote — nambari zako bado zipo hapa.',
    'nf.back':              'Rudi nyumbani',
  },
};

const LANG_KEY = 'pesalens-lang';

const detectInitial = () => {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'sw' || saved === 'en') return saved;
    const nav = (navigator?.language || 'en').toLowerCase();
    return nav.startsWith('sw') ? 'sw' : 'en';
  } catch {
    return 'en';
  }
};

let current = typeof window === 'undefined' ? 'en' : detectInitial();

export const getLang = () => current;

export const setLang = (lang) => {
  if (lang !== 'en' && lang !== 'sw') return;
  current = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang;
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent('pesalens:lang', { detail: lang }));
};

/**
 * t(key) — returns the localized string for the active language.
 * Falls back to the English entry, then to the key itself if missing.
 * Components using t() re-render on language change because they
 * subscribe via useT().
 */
export const translate = (key, lang = current) => {
  const table = dict[lang] || dict.en;
  return table[key] ?? dict.en[key] ?? key;
};

export const useT = () => {
  const [lang, setLocal] = useState(current);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
    const sync = () => setLocal(getLang());
    window.addEventListener('pesalens:lang', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('pesalens:lang', sync);
      window.removeEventListener('storage', sync);
    };
  }, [lang]);

  const t = useCallback((key) => translate(key, lang), [lang]);

  return { t, lang, setLang };
};

/* ----------------------------------------------------------------
   Runtime auto-translation.
   ----------------------------------------------------------------
   Used for strings that don't live in the static dict above —
   typically dynamic insight / anomaly / action-engine text generated
   from the user's own data. Each unique string is fetched once, then
   cached in localStorage so subsequent renders are instant.

   Why a chain of providers? The free Argos / LibreTranslate instance
   is rate-limited and frequently throttles or 502s — when that
   happens any component that depended on it silently falls back to
   English, which is what the user was seeing as "doesn't work on all
   components". We now race through several providers and stop at the
   first one that returns a non-empty translation.

   Configure with VITE_LIBRETRANSLATE_URL / VITE_LIBRETRANSLATE_API_KEY
   to add your own primary endpoint. Public providers are kept as
   fallbacks so the app still works out of the box.
   ---------------------------------------------------------------- */
const RAW_LT_URL = (
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_LIBRETRANSLATE_URL) ||
  ''
).replace(/\/+$/, '');
const LT_KEY = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_LIBRETRANSLATE_API_KEY) || '';

// Provider chain — tried in order until one succeeds. Each entry is a
// thin adapter so adding/removing providers doesn't ripple into the
// caller. All providers must accept (text, target) and return a string
// (or null on failure). They never throw.
const trProviders = [];

if (RAW_LT_URL) {
  trProviders.push({
    name: 'libretranslate-custom',
    call: async (text, target) => {
      const body = { q: text, source: 'en', target, format: 'text' };
      if (LT_KEY) body.api_key = LT_KEY;
      const res = await fetch(RAW_LT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return (data && typeof data.translatedText === 'string' && data.translatedText) || null;
    },
  });
}

// Google's public translate endpoint (used by the gtx widget) — no key
// required, surprisingly stable, returns clean Swahili. Rate limits
// exist but are forgiving for short phrases.
trProviders.push({
  name: 'google-gtx',
  call: async (text, target) => {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    // Response shape: [[[ "translated", "source", null, null, ... ], ...], null, "en"]
    if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
    const out = data[0].map((seg) => (Array.isArray(seg) ? seg[0] : '')).join('').trim();
    return out || null;
  },
});

// MyMemory is the canonical free, no-key fallback. Slow but reliable.
trProviders.push({
  name: 'mymemory',
  call: async (text, target) => {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${encodeURIComponent(target)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const out = data?.responseData?.translatedText;
    return typeof out === 'string' && out.trim() ? out : null;
  },
});

// Argos public instance — last in the chain because it's the flakiest.
trProviders.push({
  name: 'argos-public',
  call: async (text, target) => {
    const res = await fetch('https://translate.argosopentech.com/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: 'en', target, format: 'text' }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data && typeof data.translatedText === 'string' && data.translatedText) || null;
  },
});

// v3: invalidates cached entries that may have stored the bad `/Tatu`
// rendering of `/mo` from the previous translator pipeline.
const TR_CACHE_KEY = 'pesalens-tr-cache-v3';

const loadTrCache = () => {
  if (typeof localStorage === 'undefined') return { en: {}, sw: {} };
  try {
    const raw = localStorage.getItem(TR_CACHE_KEY);
    if (!raw) return { en: {}, sw: {} };
    const parsed = JSON.parse(raw);
    return {
      en: (parsed && parsed.en) || {},
      sw: (parsed && parsed.sw) || {},
    };
  } catch {
    return { en: {}, sw: {} };
  }
};

const trCache = loadTrCache();
const trPending = new Map();
let trSaveTimer = null;
const persistTrCache = () => {
  if (typeof localStorage === 'undefined' || trSaveTimer) return;
  trSaveTimer = setTimeout(() => {
    try { localStorage.setItem(TR_CACHE_KEY, JSON.stringify(trCache)); } catch { /* quota */ }
    trSaveTimer = null;
  }, 250);
};

// Skip strings that are nothing but numbers, codes, dates, currency.
const isUntranslatable = (text) => {
  if (!text) return true;
  if (text.length < 2) return true;
  return /^[\s\d.,:;!?\-—–_/\\|·•()[\]{}TZSUSDEURGBP%@#&*+=<>]+$/.test(text);
};

// Try each provider in order until one returns something. We keep this
// loop in-flight on a per-(lang,text) key so React components mounting
// the same string in parallel coalesce into a single network round.
const runProviderChain = async (text, lang) => {
  for (const provider of trProviders) {
    try {
      const out = await provider.call(text, lang);
      if (out && out.trim() && out.trim().toLowerCase() !== text.trim().toLowerCase()) {
        return out;
      }
    } catch {
      // try next provider
    }
  }
  return null;
};

// Public translation engines mistranslate compact period suffixes — e.g.
// `/mo` (short for "/month") gets read as "Mon" (Monday) and rendered as
// `/Tatu` or `Jumatatu` in Swahili. Patch those quirks in-place so the
// rendered string keeps the original compact "<value>/<period>" shape.
const fixLocaleQuirks = (out, lang) => {
  if (!out || lang !== 'sw') return out;
  return out
    .replace(/\s*\/\s*J\.?\s*Tatu\b/gi, '/mwezi')
    .replace(/\bJumatatu\b/gi, 'mwezi')
    .replace(/\s*\/\s*mo\b/gi, '/mwezi');
};

const PERMONTH_SENTINEL = '__PESALENSPERMONTH__';

export const autoTranslate = async (text, lang = current) => {
  if (!text || lang === 'en') return text;
  if (isUntranslatable(text)) return text;
  const bucket = trCache[lang] || (trCache[lang] = {});
  if (bucket[text]) return bucket[text];
  const key = `${lang}::${text}`;
  if (trPending.has(key)) return trPending.get(key);

  // Hide "/mo" behind a sentinel so translators don't mis-read it as a
  // weekday abbreviation. We restore "/mwezi" on the way out, ALWAYS — even
  // if the provider chain returned nothing usable, so a literal "/mo" never
  // survives into Swahili output.
  const probe = text.replace(/\/mo\b/gi, PERMONTH_SENTINEL);

  const promise = (async () => {
    try {
      let out = await runProviderChain(probe, lang);
      if (!out) out = probe;  // translator passed through — keep going
      out = out.replace(new RegExp(PERMONTH_SENTINEL, 'g'), '/mwezi');
      out = fixLocaleQuirks(out, lang);
      bucket[text] = out;
      persistTrCache();
      return out;
    } finally {
      trPending.delete(key);
    }
  })();
  trPending.set(key, promise);
  return promise;
};

// Pre-warm a batch of strings — used when a screen mounts so the user
// sees Swahili copy immediately on the next paint instead of an
// English flash. Returns once every string has resolved (or failed).
export const primeTranslations = async (texts, lang = current) => {
  if (lang === 'en') return;
  await Promise.all(
    (texts || [])
      .filter((t) => t && typeof t === 'string')
      .map((t) => autoTranslate(t, lang).catch(() => t)),
  );
};

/**
 * useAutoT(text) — returns the live-translated version of an arbitrary
 * English string. Renders the original immediately, then swaps in the
 * Swahili translation when LibreTranslate responds.
 */
export const useAutoT = (text) => {
  const { lang } = useT();
  const initial = !text || lang === 'en' ? text : ((trCache[lang] && trCache[lang][text]) || text);
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (!text || lang === 'en') {
      setValue(text);
      return undefined;
    }
    const cached = trCache[lang] && trCache[lang][text];
    if (cached) {
      setValue(cached);
      return undefined;
    }
    setValue(text);
    let alive = true;
    autoTranslate(text, lang).then((out) => {
      if (alive) setValue(out);
    });
    return () => { alive = false; };
  }, [text, lang]);

  return value;
};

/**
 * <AutoT>english string</AutoT> — drop-in wrapper for dynamic backend
 * text. Renders nothing extra; just returns the translated string node.
 */
export const AutoT = ({ children }) => {
  const text = typeof children === 'string'
    ? children
    : (children == null ? '' : String(children));
  return useAutoT(text);
};
