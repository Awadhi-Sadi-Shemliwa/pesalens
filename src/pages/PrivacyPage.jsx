import React from 'react';
import { Link } from '../components/Router';
import { Icon } from '../components/Icon';
import { Mark, Eyebrow } from '../components/common';

/* ------------------------------------------------------------------
   Privacy Policy — plain-language, English-only legal page. Publicly
   reachable at /privacy (linked from the landing footer) and required
   by Google Ads' destination policy before ads can point at the site.
   Content is static; bump LAST_UPDATED when the policy text changes.
   ------------------------------------------------------------------ */

const LAST_UPDATED = '16 July 2026';
const CONTACT_EMAIL = 'awadhishemliwa@gmail.com';

const Section = ({ title, children }) => (
  <section className="mt-10">
    <h2 className="text-lg font-semibold tracking-tight text-txt-1">{title}</h2>
    <div className="mt-3 space-y-3 text-sm leading-relaxed text-txt-2">{children}</div>
  </section>
);

const PrivacyPage = () => (
  <div className="min-h-screen bg-deep relative overflow-hidden">
    <div className="absolute inset-0 grid-faint opacity-50 pointer-events-none" />
    <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
      <div className="flex items-center justify-between gap-4">
        <Link to="/" aria-label="PesaLens home"><Mark size={32} /></Link>
        <Link
          to="/"
          className="press inline-flex items-center gap-2 text-sm text-txt-2 hover:text-txt-1 transition"
        >
          <Icon name="arrowRight" size={14} className="rotate-180" />
          Back to home
        </Link>
      </div>

      <div className="mt-10">
        <Eyebrow>Legal</Eyebrow>
        <h1 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tightest">Privacy Policy</h1>
        <p className="mt-2 text-sm text-txt-3 font-mono uppercase tracking-ticker">
          Last updated: {LAST_UPDATED}
        </p>
      </div>

      <Section title="Who we are">
        <p>
          PesaLens (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a Tanzania-first personal-finance service at{' '}
          <span className="text-txt-1">pesalens.com</span> and in the PesaLens Android app. It reads
          your bank statements and turns them into analysis, bookkeeping, and planning tools. This
          policy explains what data we collect, why, and the choices you have.
        </p>
      </Section>

      <Section title="Data we collect">
        <p>
          <span className="text-txt-1">Account details</span> — your email address, name, and a
          hashed password when you create an account.
        </p>
        <p>
          <span className="text-txt-1">Bank statements you upload</span> — the PDF files you choose
          to analyse and the transactions extracted from them (dates, amounts, descriptions,
          balances). We never connect to your bank; we only see what you upload.
        </p>
        <p>
          <span className="text-txt-1">Derived analytics</span> — categorised spending, income
          summaries, and bookkeeping entries generated from your statements or entered by you.
        </p>
        <p>
          <span className="text-txt-1">Payment confirmations</span> — when you upgrade, we record
          the payment reference, amount, and plan period. Card or mobile-money details are handled
          by the payment provider, not stored by us.
        </p>
        <p>
          <span className="text-txt-1">Usage data</span> — pages visited and basic device
          information, via Google Analytics (see Cookies below).
        </p>
      </Section>

      <Section title="How we use your data">
        <p>
          To run the product: extracting and analysing your statements, showing your dashboards,
          answering your questions through the AI assistant, and managing your subscription. We also
          use aggregate, de-identified usage data to improve PesaLens. We do <span className="text-txt-1">not</span>{' '}
          sell your personal data, and we do not share your financial data with advertisers.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          <span className="text-txt-1">Authentication cookie</span> — a secure, httpOnly cookie
          keeps you signed in. It is essential and holds no tracking information.
        </p>
        <p>
          <span className="text-txt-1">Google Analytics</span> — we use Google Analytics 4
          (cookies such as <span className="font-mono text-xs">_ga</span>) to understand how
          visitors use the site — pages viewed, approximate location, device type. Google&rsquo;s own
          privacy policy applies to this processing. You can block these cookies in your browser or
          with an ad-blocker without affecting the product.
        </p>
      </Section>

      <Section title="Third-party services">
        <p>
          <span className="text-txt-1">Google Analytics</span> for usage measurement (above).
        </p>
        <p>
          <span className="text-txt-1">AI providers</span> — statement text is processed by AI
          services to extract and categorise transactions and to answer assistant questions. These
          providers process the data on our behalf and are not permitted to use it for their own
          purposes.
        </p>
        <p>
          <span className="text-txt-1">Email delivery</span> — transactional emails (sign-up
          passwords, payment confirmations) are sent through an email delivery provider.
        </p>
      </Section>

      <Section title="Retention & deletion">
        <p>
          Your data is kept while your account is active. You can delete uploaded statements from
          the app at any time. To delete your account and all associated data, email us at the
          address below — we remove it from our systems within 30 days, except records we must keep
          for legal or accounting reasons.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You may request a copy of the personal data we hold about you, ask us to correct it, or
          ask us to delete it. Contact us and we will respond within a reasonable time, consistent
          with the Tanzania Personal Data Protection Act and other applicable law.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about this policy or your data:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent hover:underline">
            {CONTACT_EMAIL}
          </a>
        </p>
      </Section>

      <div className="mt-14 border-t border-bdr pt-6 text-xs text-txt-3 font-mono uppercase tracking-ticker">
        PesaLens — Financial Intelligence for Tanzania
      </div>
    </div>
  </div>
);

export default PrivacyPage;
