import React, { useState, useEffect, useRef } from 'react';
import { AppShell } from '../components/navigation';
import { Icon } from '../components/Icon';
import { Badge, Eyebrow } from '../components/common';
import { fetchDashboardSummary, sendAssistantMessage, fmtTZS } from '../data/api';
import { useT } from '../data/i18n';

const AssistantPage = () => {
  const { t } = useT();
  const WELCOME = { role: 'ai', text: t('ai.welcome') };
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [summary, setSummary] = useState(null);
  const chatEnd = useRef(null);

  const suggestions = [
    t('ai.suggest.1'),
    t('ai.suggest.2'),
    t('ai.suggest.3'),
    t('ai.suggest.4'),
  ];

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
    } finally {
      setTyping(false);
    }
  };

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  const meta = summary?.latest_upload;
  const k = summary?.kpis || {};
  const issues = summary?.issues || [];
  const categories = summary?.categories || [];

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-7rem)] sm:h-[calc(100vh-7rem)] gap-5">
        <div className="flex-1 flex flex-col card-soft overflow-hidden min-w-0">
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-bdr/70 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="relative">
                <span className="absolute inset-0 bg-accent/20 blur-md rounded-lg" />
                <div className="relative p-2 rounded-lg bg-accent/10 border border-accent/25">
                  <Icon name="bot" size={16} className="text-accent" />
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-sm tracking-tight">{t('ai.title')}</h3>
                <p className="text-[11px] text-txt-3 font-mono uppercase tracking-ticker">{t('ai.subtitle')}</p>
              </div>
            </div>
            <span className="hidden sm:inline-flex items-center gap-2 text-[11px] text-inc font-mono uppercase tracking-ticker">
              <span className="w-1.5 h-1.5 rounded-full bg-inc" />
              {t('common.online')}
            </span>
          </div>
          <div className="flex-1 overflow-auto p-3 sm:p-6 space-y-4">
            {messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] sm:max-w-[80%] rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 text-sm leading-relaxed whitespace-pre-wrap break-words ${message.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'}`}>
                  {message.role === 'ai' && (
                    <div className="flex items-center gap-2 mb-2">
                      <Icon name="aperture" size={12} className="text-accent" />
                      <span className="text-[11px] font-mono uppercase tracking-ticker text-accent">pesalens</span>
                    </div>
                  )}
                  {message.text}
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
          {messages.length <= 1 && (
            <div className="px-3 sm:px-6 pb-3 flex flex-wrap gap-2">
              {suggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={() => send(suggestion)}
                  className="text-xs bg-surface-3 border border-bdr rounded-full px-3 py-1.5 text-txt-2 hover:text-txt-1 hover:border-bdr-hover hover:bg-surface-4 transition"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          <div className="p-3 sm:p-4 border-t border-bdr/70">
            <div className="flex items-center gap-2 bg-surface-3 border border-bdr rounded-xl px-3 sm:px-4 py-2 focus-within:border-accent/40 transition">
              <Icon name="sparkles" size={14} className="text-txt-3" />
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && send(input)}
                placeholder={t('ai.placeholder')}
                className="flex-1 bg-transparent text-sm text-txt-1 placeholder-txt-3 outline-none"
              />
              <button
                onClick={() => send(input)}
                disabled={typing || !input.trim()}
                className="btn-primary p-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ boxShadow: 'none' }}
              >
                <Icon name="send" size={13} className="text-white" />
              </button>
            </div>
          </div>
        </div>

        <div className="hidden xl:flex w-80 flex-col gap-5">
          <div className="card-soft p-5">
            <Eyebrow>{t('ai.snapshot.eyebrow')}</Eyebrow>
            <h4 className="mt-2 mb-4 font-semibold text-sm tracking-tight">{t('ai.snapshot.title')}</h4>
            {meta ? (
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-txt-3 text-xs uppercase tracking-ticker font-mono">{t('common.bank')}</span><span className="font-medium uppercase tabular text-xs text-txt-1">{meta.bank || '—'}</span></div>
                <div className="flex justify-between"><span className="text-txt-3 text-xs uppercase tracking-ticker font-mono">{t('common.transactions')}</span><span className="font-medium tabular text-xs text-txt-1">{meta.total_transactions ?? '—'}</span></div>
                <div className="h-px bg-bdr/60 my-2" />
                <div className="flex justify-between"><span className="text-txt-2">{t('common.moneyIn')}</span><span className="font-semibold text-inc tabular text-sm">{fmtTZS(k.money_in)}</span></div>
                <div className="flex justify-between"><span className="text-txt-2">{t('common.moneyOut')}</span><span className="font-semibold text-exp tabular text-sm">{fmtTZS(k.money_out)}</span></div>
                <div className="flex justify-between"><span className="text-txt-2">{t('common.netFlow')}</span><span className="font-semibold text-net tabular text-sm">{fmtTZS(k.net_flow)}</span></div>
              </div>
            ) : (
              <p className="text-xs text-txt-3">{t('ai.snapshot.empty')}</p>
            )}
          </div>
          <div className="card-soft p-5">
            <Eyebrow>{t('ai.spending.eyebrow')}</Eyebrow>
            <h4 className="mt-2 mb-4 font-semibold text-sm tracking-tight">{t('ai.spending.title')}</h4>
            {categories.length > 0 ? (
              <div className="space-y-2">
                {categories.slice(0, 5).map((category, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs surface-inset rounded-lg p-2.5">
                    <span className="text-txt-2">{category.name}</span>
                    <span className="font-medium tabular text-txt-1">{fmtTZS(category.value)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-txt-3">{t('ai.spending.empty')}</p>
            )}
          </div>
          <div className="card-soft p-5">
            <Eyebrow>{t('ai.anom.eyebrow')}</Eyebrow>
            <h4 className="mt-2 mb-3 font-semibold text-sm tracking-tight">{t('ai.anom.title')}</h4>
            {issues.length > 0 ? (
              issues.map((issue, idx) => (
                <div key={idx} className="flex items-start justify-between gap-2 py-2 border-b border-bdr/50 last:border-0">
                  <span className="text-xs text-txt-2 leading-snug">{issue.title}</span>
                  <Badge color={issue.severity === 'critical' ? 'danger' : issue.severity === 'warning' ? 'expense' : 'muted'}>
                    {issue.severity}
                  </Badge>
                </div>
              ))
            ) : (
              <p className="text-xs text-txt-3">{t('ai.anom.empty')}</p>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
};

export default AssistantPage;
