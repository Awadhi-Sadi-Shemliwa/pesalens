import React, { useState, useEffect, useRef } from 'react';
import { AppShell } from '../components/navigation';
import { Icon } from '../components/Icon';
import { Badge, Eyebrow, toast } from '../components/common';
import { Markdown } from '../components/Markdown';
import { useReducedMotion } from '../components/motion';
import { fetchDashboardSummary, sendAssistantMessage, fmtTZS } from '../data/api';
import { getCurrentUser } from '../data/authStore';
import { useT } from '../data/i18n';

/* ================================================================
   AssistantPage — modelled on the "AI assistant UI" reference:
   a centred greeting, a glassmorphic prompt console floating over a
   faint circuit background, and three glass "explore" cards. Those
   three cards carry the user's live context — STATEMENT, SPENDING and
   ANOMALIES — so the assistant always opens grounded on real data.

   Two modes share one prompt console:
     • Hero    (no conversation yet) → greeting + big prompt + cards.
     • Session (chatting)            → context strip + transcript.
   ================================================================ */

/* Faint circuit tracery that converges on the prompt console — the
   "wires feeding the AI" motif from the reference. Data pulses along
   the traces unless the user prefers reduced motion. */
const CircuitBg = () => {
  const reduced = useReducedMotion();
  const traces = [
    'M0 120 H180 Q210 120 210 150 V210',
    'M0 300 H120 Q150 300 150 270 V220',
    'M760 90 H620 Q590 90 590 130 V210',
    'M760 320 H660 Q630 320 630 280 V220',
    'M380 0 V80',
    'M380 380 V300',
  ];
  const nodes = [[0, 120], [0, 300], [760, 90], [760, 320], [180, 120], [120, 300], [620, 90], [660, 320]];
  return (
    <svg
      aria-hidden
      viewBox="0 0 760 380"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.5]"
    >
      <defs>
        <radialGradient id="ai-node" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgb(var(--c-accent))" stopOpacity="0.9" />
          <stop offset="100%" stopColor="rgb(var(--c-accent))" stopOpacity="0" />
        </radialGradient>
      </defs>
      {traces.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={i % 2 ? 'rgb(var(--c-net))' : 'rgb(var(--c-accent))'}
          strokeWidth="1"
          strokeOpacity="0.25"
          className={reduced ? '' : 'cashflow-stream'}
          style={{ animationDelay: `${-i * 0.6}s` }}
        />
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="10" fill="url(#ai-node)" opacity="0.4" />
      ))}
    </svg>
  );
};

/* Shared prompt console — the floating glass bar from the reference. */
const PromptConsole = ({ input, setInput, onSend, typing, chips = [], onChip, big }) => {
  const { t } = useT();
  return (
    <div className={`glass-pane rounded-[24px] border border-accent/25 relative overflow-hidden ${big ? 'p-4 sm:p-5' : 'p-3 sm:p-4'}`}>
      <span aria-hidden className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-32 rounded-full blur-3xl bg-accent/15 pointer-events-none" />
      <span aria-hidden className="absolute -bottom-16 -right-10 w-56 h-40 rounded-full blur-3xl bg-net/15 pointer-events-none" />
      {big && (
        <p className="relative text-[11px] uppercase tracking-ticker text-txt-3 font-mono mb-3 px-1">
          {t('ai.explore')}
        </p>
      )}
      {big && chips.length > 0 && (
        <div className="relative flex flex-wrap gap-2 mb-3">
          {chips.map((c, i) => (
            <button
              key={i}
              onClick={() => onChip(c)}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-surface-4/60 border border-bdr/60 text-txt-2 hover:text-txt-1 hover:border-accent/40 hover:bg-accent/5 transition"
            >
              <Icon name="sparkles" size={12} className="text-accent" />
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="relative flex items-center gap-2 bg-surface-3/70 border border-bdr rounded-2xl px-3 sm:px-4 py-2.5 focus-ring-within transition">
        <Icon name="aperture" size={16} className="text-accent flex-shrink-0" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSend(input)}
          placeholder={t('ai.placeholder')}
          className="flex-1 bg-transparent text-sm text-txt-1 placeholder-txt-3 outline-none"
        />
        <button
          onClick={() => onSend(input)}
          disabled={typing || !input.trim()}
          className="press btn-primary p-2.5 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          aria-label={t('ai.send')}
        >
          <Icon name="send" size={14} />
        </button>
      </div>
    </div>
  );
};

/* One of the three grounded "explore" cards (Statement / Spending /
   Anomalies). Clicking it seeds the console with a tailored prompt. */
const ContextCard = ({ eyebrow, title, icon, tone, onAsk, prompt, children, compact }) => (
  <button
    onClick={() => onAsk(prompt)}
    className={`group text-left glass-pane rounded-2xl border border-bdr/60 hover:border-accent/40 transition relative overflow-hidden w-full ${compact ? 'p-3' : 'p-4 sm:p-5'}`}
  >
    <span aria-hidden className={`absolute -right-8 -top-8 w-24 h-24 rounded-full blur-2xl ${tone.glow} pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity`} />
    <div className="relative flex items-center justify-between gap-2 mb-2.5">
      <span className={`p-1.5 rounded-lg ${tone.chip}`}><Icon name={icon} size={14} /></span>
      <Icon name="arrowUpRight" size={14} className="text-txt-3 group-hover:text-accent transition" />
    </div>
    <div className="relative">
      <div className="text-[10px] uppercase tracking-ticker text-txt-3 font-mono">{eyebrow}</div>
      <div className="text-sm font-semibold tracking-tight mb-2">{title}</div>
      {children}
    </div>
  </button>
);

const TONE = {
  accent: { chip: 'bg-accent/10 text-accent', glow: 'bg-accent/20' },
  net:    { chip: 'bg-net/10 text-net',        glow: 'bg-net/20' },
  exp:    { chip: 'bg-exp/10 text-exp',        glow: 'bg-exp/20' },
};

const AssistantPage = () => {
  const { t } = useT();
  const WELCOME = { role: 'ai', text: t('ai.welcome') };
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [summary, setSummary] = useState(null);
  const [copied, setCopied] = useState(false);
  const chatEnd = useRef(null);

  const user = getCurrentUser();
  const firstName =
    (user?.full_name && user.full_name.split(' ')[0]) ||
    (user?.email && user.email.split('@')[0]) ||
    'there';

  const suggestions = [t('ai.suggest.1'), t('ai.suggest.2'), t('ai.suggest.3'), t('ai.suggest.4')];

  useEffect(() => {
    fetchDashboardSummary().then(setSummary).catch(() => setSummary(null));
  }, []);

  const send = async (text) => {
    if (!text.trim() || typing) return;
    const userMessage = { role: 'user', text };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput('');
    setTyping(true);
    try {
      const reply = await sendAssistantMessage(text, history);
      setMessages((prev) => [...prev, { role: 'ai', text: reply || 'No response.' }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'ai', text: `Sorry, I could not process that. (${err.message || 'unknown error'})` },
      ]);
      /* The in-chat bubble alone reads like the assistant *answered*. A toast makes
         it unambiguous that the request failed rather than being declined (§65). */
      toast.error(err.message || 'The assistant could not be reached.', { title: 'Message failed' });
    } finally {
      setTyping(false);
    }
  };

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  // Client-side transcript copy — the reference's "Export Chat". No file
  // is downloaded and no data leaves the browser; it just copies the
  // visible conversation to the clipboard.
  const exportChat = async () => {
    const text = messages
      .map((m) => `${m.role === 'user' ? 'You' : 'PesaLens AI'}: ${m.text}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* A blocked clipboard used to fail silently, so the button simply never
         confirmed and the user could not tell why (§65). */
      toast.error('Your browser blocked clipboard access. Select the transcript and copy it manually.', {
        title: 'Could not copy chat',
      });
    }
  };

  const meta = summary?.latest_upload;
  const k = summary?.kpis || {};
  const issues = summary?.issues || [];
  const categories = summary?.categories || [];
  const hasChat = messages.length > 1;

  /* The three grounded context cards, reused in both modes. */
  const cards = (
    <>
      <ContextCard
        eyebrow={t('ai.snapshot.eyebrow')} title={t('ai.snapshot.title')}
        icon="receipt" tone={TONE.accent}
        onAsk={send} prompt={t('ai.card.statement')}
      >
        {meta ? (
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-txt-3">{t('common.bank')}</span><span className="font-medium uppercase tabular text-txt-1">{meta.bank || '—'}</span></div>
            <div className="flex justify-between"><span className="text-txt-3">{t('common.moneyIn')}</span><span className="font-semibold text-inc tabular">{fmtTZS(k.money_in)}</span></div>
            <div className="flex justify-between"><span className="text-txt-3">{t('common.moneyOut')}</span><span className="font-semibold text-exp tabular">{fmtTZS(k.money_out)}</span></div>
            <div className="flex justify-between"><span className="text-txt-3">{t('common.netFlow')}</span><span className="font-semibold text-net tabular">{fmtTZS(k.net_flow)}</span></div>
          </div>
        ) : (
          <p className="text-xs text-txt-3">{t('ai.snapshot.empty')}</p>
        )}
      </ContextCard>

      <ContextCard
        eyebrow={t('ai.spending.eyebrow')} title={t('ai.spending.title')}
        icon="chart" tone={TONE.net}
        onAsk={send} prompt={t('ai.card.spending')}
      >
        {categories.length > 0 ? (
          <div className="space-y-1.5">
            {categories.slice(0, 4).map((c, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs">
                <span className="text-txt-2 truncate mr-2">{c.name}</span>
                <span className="font-medium tabular text-txt-1 flex-shrink-0">{fmtTZS(c.value)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-txt-3">{t('ai.spending.empty')}</p>
        )}
      </ContextCard>

      <ContextCard
        eyebrow={t('ai.anom.eyebrow')} title={t('ai.anom.title')}
        icon="alert" tone={TONE.exp}
        onAsk={send} prompt={t('ai.card.anomalies')}
      >
        {issues.length > 0 ? (
          <div className="space-y-2">
            {issues.slice(0, 3).map((issue, idx) => (
              <div key={idx} className="flex items-start justify-between gap-2">
                <span className="text-xs text-txt-2 leading-snug">{issue.title}</span>
                <Badge color={issue.severity === 'critical' ? 'danger' : issue.severity === 'warning' ? 'expense' : 'muted'}>
                  {issue.severity}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-txt-3">{t('ai.anom.empty')}</p>
        )}
      </ContextCard>
    </>
  );

  return (
    <AppShell>
      <div className="relative min-h-[calc(100vh-8rem)] flex flex-col overflow-x-hidden">
        <CircuitBg />

        {/* Top bar: model chip + export */}
        <div className="relative flex items-center justify-between gap-3 mb-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass-pane border border-bdr/60">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-inc opacity-60 animate-ping" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-inc" />
            </span>
            <span className="text-xs font-semibold">{t('ai.title')}</span>
            <span className="text-[10px] text-txt-3 font-mono">v5.0</span>
          </div>
          <button
            onClick={exportChat}
            disabled={!hasChat}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-bdr hover:border-accent/40 text-xs text-txt-2 hover:text-txt-1 transition disabled:opacity-40"
          >
            <Icon name={copied ? 'check' : 'download'} size={13} />
            {copied ? t('ai.copied') : t('ai.export')}
          </button>
        </div>

        {!hasChat ? (
          /* ---------------- HERO MODE ---------------- */
          <div className="relative flex-1 flex flex-col items-center justify-center py-6 sm:py-10">
            <div className="text-center mb-8 max-w-2xl">
              <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight text-txt-2">
                {t('ai.hello').replace('{name}', firstName)}
              </h1>
              <h2 className="text-2xl sm:text-4xl font-semibold tracking-tight mt-1 bg-clip-text text-transparent"
                  style={{ backgroundImage: 'linear-gradient(90deg, rgb(var(--c-accent)), rgb(var(--c-net)))' }}>
                {t('ai.howHelp')}
              </h2>
            </div>

            <div className="w-full max-w-2xl">
              <PromptConsole
                big input={input} setInput={setInput} onSend={send} typing={typing}
                chips={suggestions} onChip={send}
              />
            </div>

            <div className="w-full max-w-3xl grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-6">
              {cards}
            </div>
          </div>
        ) : (
          /* ---------------- SESSION MODE ---------------- */
          <div className="relative flex-1 flex flex-col min-h-0">
            {/* Context strip keeps STATEMENT/SPENDING/ANOMALIES in reach */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-3">
              <ContextCard compact eyebrow={t('ai.snapshot.eyebrow')} title={t('common.netFlow')} icon="receipt" tone={TONE.accent} onAsk={send} prompt={t('ai.card.statement')}>
                <span className="text-sm font-semibold text-net tabular">{fmtTZS(k.net_flow)}</span>
              </ContextCard>
              <ContextCard compact eyebrow={t('ai.spending.eyebrow')} title={t('ai.spending.title')} icon="chart" tone={TONE.net} onAsk={send} prompt={t('ai.card.spending')}>
                <span className="text-sm font-semibold text-txt-1 tabular">{categories[0]?.name || '—'}</span>
              </ContextCard>
              <ContextCard compact eyebrow={t('ai.anom.eyebrow')} title={t('ai.anom.title')} icon="alert" tone={TONE.exp} onAsk={send} prompt={t('ai.card.anomalies')}>
                <span className="text-sm font-semibold text-txt-1 tabular">{issues.length} {t('ai.flagged')}</span>
              </ContextCard>
            </div>

            <div className="glass-pane rounded-[22px] border border-bdr/60 flex flex-col overflow-hidden h-[calc(100vh-20rem)] min-h-[380px]">
              <div className="flex-1 overflow-auto p-3 sm:p-6 space-y-4">
                {messages.map((message, index) => (
                  <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[88%] sm:max-w-[80%] rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 text-sm leading-relaxed break-words ${message.role === 'user' ? 'chat-bubble-user whitespace-pre-wrap' : 'chat-bubble-ai'}`}>
                      {message.role === 'ai' && (
                        <div className="flex items-center gap-2 mb-2">
                          <Icon name="aperture" size={12} className="text-accent" />
                          <span className="text-[11px] font-mono uppercase tracking-ticker text-accent">pesalens</span>
                        </div>
                      )}
                      {message.role === 'ai' ? <Markdown text={message.text} /> : message.text}
                    </div>
                  </div>
                ))}
                {typing && (
                  <div className="flex justify-start">
                    <div className="chat-bubble-ai rounded-2xl px-4 py-3 flex gap-1.5 items-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent" style={{ animation: 'pulse-soft 1s infinite' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-accent" style={{ animation: 'pulse-soft 1s infinite .15s' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-accent" style={{ animation: 'pulse-soft 1s infinite .3s' }} />
                    </div>
                  </div>
                )}
                <div ref={chatEnd} />
              </div>
              <div className="p-3 sm:p-4 border-t border-bdr/60">
                <PromptConsole input={input} setInput={setInput} onSend={send} typing={typing} />
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default AssistantPage;
