import React from 'react';
import { Link } from '../components/Router';
import { Icon } from '../components/Icon';
import { Mark, Eyebrow } from '../components/common';
import { useT } from '../data/i18n';

const NotFoundPage = () => {
  const { t } = useT();
  return (
    <div className="min-h-screen bg-deep flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 grid-faint opacity-50 pointer-events-none" />
      <div className="hero-glow bg-accent" style={{ top: '20%', left: '30%' }} />
      <div className="text-center relative z-10 max-w-md">
        <div className="mb-8 flex justify-center"><Mark size={36} /></div>
        <Eyebrow num="404" className="mx-auto inline-flex">{t('nf.eyebrow')}</Eyebrow>
        <h2 className="mt-5 text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tightest leading-[1.05]">
          {t('nf.title.l1')}<br />
          <span className="font-serif-i text-txt-2">{t('nf.title.l2')}</span> {t('nf.title.l3')}
        </h2>
        <p className="text-txt-2 my-6 leading-relaxed">
          {t('nf.lede')}
        </p>
        <Link to="/" className="press btn-primary px-6 py-3 rounded-xl text-sm font-semibold inline-flex items-center gap-2">
          <Icon name="arrowRight" size={14} className="rotate-180" />
          {t('nf.back')}
        </Link>
      </div>
    </div>
  );
};

export default NotFoundPage;
