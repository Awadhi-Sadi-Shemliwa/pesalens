import React from 'react';
import { Link } from '../components/Router';
import { Icon } from '../components/Icon';
import { Mark, Eyebrow } from '../components/common';

/* ------------------------------------------------------------------
   Terms of Service — publicly reachable at /terms, linked from the
   landing footer beside the Privacy Policy.

   The content here is the SAME agreement the Android app shows at
   PesaLens-MobileAPP/src/pages/Terms.tsx. Only the presentation differs
   (web page chrome vs. mobile stack header). A fintech that states
   different terms depending on which app you opened has a real legal
   problem, not a cosmetic one — so if you change a clause here, change
   it there in the same commit, and bump EFFECTIVE_DATE in both.
   ------------------------------------------------------------------ */

const EFFECTIVE_DATE = '10 May 2026';
const COMPANY_LEGAL = 'PesaLens';
const CONTACT_EMAIL = 'legal@pesalens.com';
const SUPPORT_EMAIL = 'support@pesalens.com';
const JURISDICTION = 'United Republic of Tanzania';
const COURTS = 'courts of Dar es Salaam, Tanzania';

const Section = ({ n, title, children }) => (
  <section className="mt-10">
    <h2 className="text-lg font-semibold tracking-tight text-txt-1">
      <span className="text-txt-3 font-mono text-sm mr-2.5">{String(n).padStart(2, '0')}</span>
      {title}
    </h2>
    <div className="mt-3 space-y-3 text-sm leading-relaxed text-txt-2">{children}</div>
  </section>
);

const Bullets = ({ items }) => (
  <ul className="list-disc pl-5 space-y-1.5">
    {items.map((item, i) => <li key={i}>{item}</li>)}
  </ul>
);

const Mail = ({ address }) => (
  <a href={`mailto:${address}`} className="text-accent hover:underline">{address}</a>
);

const TermsPage = () => (
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
        <h1 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tightest">Terms of Service</h1>
        <p className="mt-2 text-sm text-txt-3 font-mono uppercase tracking-ticker">
          Effective: {EFFECTIVE_DATE}
        </p>
      </div>

      <p className="mt-6 text-sm leading-relaxed text-txt-2">
        These Terms of Service (&ldquo;<strong className="text-txt-1">Terms</strong>&rdquo;) form a
        binding agreement between you (&ldquo;<strong className="text-txt-1">you</strong>&rdquo;,
        &ldquo;<strong className="text-txt-1">your</strong>&rdquo;,
        &ldquo;<strong className="text-txt-1">User</strong>&rdquo;) and {COMPANY_LEGAL}
        {' '}(&ldquo;<strong className="text-txt-1">PesaLens</strong>&rdquo;,
        &ldquo;<strong className="text-txt-1">we</strong>&rdquo;,
        &ldquo;<strong className="text-txt-1">us</strong>&rdquo;,
        &ldquo;<strong className="text-txt-1">our</strong>&rdquo;) governing your access to and use
        of the PesaLens mobile application, web application, APIs, and related services
        (collectively, the &ldquo;<strong className="text-txt-1">Service</strong>&rdquo;). By
        creating an account, signing in, uploading a statement, or otherwise using the Service, you
        confirm that you have read, understood, and accepted these Terms and our{' '}
        <Link to="/privacy" className="text-accent hover:underline font-medium">Privacy Policy</Link>.
        If you do not agree, do not use the Service.
      </p>

      <Section n={1} title="The Service — what PesaLens is, and what it is not">
        <p>
          PesaLens is a personal-finance and bookkeeping tool that ingests bank and mobile-money
          statements, reconstructs your transaction ledger, categorises spending, and surfaces
          analytics. It is an <strong className="text-txt-1">informational tool only</strong>.
        </p>
        <p>
          PesaLens is <strong className="text-txt-1">not</strong> a bank, broker, dealer, payment
          service provider, electronic money issuer, money-transfer agent, custodian, investment
          adviser, tax adviser, accountant, or law firm. We do not hold, move, lend, invest, or
          custody money for you. We do not execute trades. We do not give personalised investment,
          tax, accounting, or legal advice.
        </p>
        <p>
          Any market data, indicator, score, projection, &ldquo;recommendation&rdquo;, or commentary
          shown in the Service is for educational and informational purposes only and is not an
          offer, solicitation, or recommendation to buy, sell, or hold any security, currency,
          asset, or financial product. <strong className="text-txt-1">You are solely
          responsible</strong> for any financial, investment, tax, or business decision you make.
          Always consult a licensed professional before acting.
        </p>
      </Section>

      <Section n={2} title="Eligibility">
        <p>To use the Service you confirm that:</p>
        <Bullets items={[
          'You are at least 18 years old, or the legal age of majority in your jurisdiction, whichever is higher.',
          'You have full legal capacity to enter into a binding contract.',
          'You are not prohibited from using the Service under any applicable law, including sanctions, anti-money-laundering ("AML"), or counter-terrorism-financing ("CTF") regulations.',
          'If you use the Service on behalf of a business, you are authorised to bind that business and accept these Terms on its behalf.',
        ]} />
        <p>
          We may, at our sole discretion, refuse to provide the Service to anyone for any lawful
          reason, including failure to satisfy the above.
        </p>
      </Section>

      <Section n={3} title="Your account and credentials">
        <p>
          You must provide accurate, current, and complete information when creating your account,
          and keep that information up to date. You are responsible for all activity under your
          account, including activity by anyone you allow to access your device, email inbox, or
          one-time password.
        </p>
        <p>
          You agree to: (a) keep your password confidential; (b) not share your account or session
          token with anyone; (c) sign out from shared devices; and (d) notify us immediately at{' '}
          <Mail address={SUPPORT_EMAIL} /> of any unauthorised access or suspected breach. We are
          not liable for losses caused by your failure to safeguard your credentials.
        </p>
      </Section>

      <Section n={4} title="Statements, content, and your data licence to us">
        <p>
          When you upload a bank or mobile-money statement, receipt, ledger entry, or any other
          content (&ldquo;<strong className="text-txt-1">User Content</strong>&rdquo;), you confirm
          that:
        </p>
        <Bullets items={[
          'The User Content belongs to you, or you have all rights, consents, and authority required to upload and process it.',
          'Uploading and processing the User Content does not violate any law, contract, bank/operator terms, or third-party rights.',
          'The User Content does not contain malware, illegal content, or content that infringes intellectual-property or privacy rights of others.',
        ]} />
        <p>
          You grant PesaLens a worldwide, non-exclusive, royalty-free licence to host, copy,
          transmit, parse, transform, store, and process your User Content strictly for the purpose
          of providing the Service to you, improving extraction accuracy, securing the platform,
          complying with law, and producing aggregated, de-identified analytics. We do not sell your
          raw User Content or use it to train third-party foundation models on identifiable data.
          You retain ownership of your User Content.
        </p>
      </Section>

      <Section n={5} title="Accuracy disclaimer — verify before you act">
        <p>
          Statement extraction relies on OCR, layout heuristics, and machine-learning models.
          Despite our best efforts, the Service may misclassify, misread, omit, or duplicate
          transactions, fees, balances, dates, or counter-parties — particularly where the source
          PDF is scanned, low-quality, password-protected, multilingual, or in a non-standard
          format.
        </p>
        <p>
          <strong className="text-txt-1">You must independently verify</strong> any number, ledger,
          balance, tax figure, KPI, P&amp;L line, or insight produced by the Service against your
          official bank, mobile-money, or accounting records before relying on it for any financial,
          business, tax, or legal purpose. PesaLens is not a substitute for an accountant, auditor,
          or qualified adviser.
        </p>
      </Section>

      <Section n={6} title="Acceptable use">
        <p>You agree not to, and not to attempt to:</p>
        <Bullets items={[
          'Upload content you do not own or are not authorised to process.',
          'Use the Service for money laundering, terrorist financing, sanctions evasion, fraud, tax evasion, or any other unlawful purpose.',
          'Reverse-engineer, decompile, scrape, or attempt to extract source code, model weights, or proprietary heuristics from the Service, except to the extent expressly permitted by law.',
          'Probe, scan, stress-test, or attempt to bypass authentication, rate-limits, or security controls.',
          'Use the Service to build a competing product, or to train or fine-tune a competing model.',
          'Resell, sublicense, white-label, or commercially redistribute the Service without our prior written consent.',
          'Upload viruses, exploits, or malicious code.',
          'Impersonate any person or entity, or misrepresent your affiliation.',
        ]} />
        <p>
          We reserve the right to investigate suspected violations and to suspend or terminate
          offending accounts without prior notice.
        </p>
      </Section>

      <Section n={7} title="AML, KYC, and reporting">
        <p>
          PesaLens may be required by applicable AML/CTF, sanctions, and tax-reporting laws —
          including those of the {JURISDICTION} — to verify user identity, monitor suspicious
          activity, freeze accounts, retain records, and report transactions or user information to
          competent authorities including the Financial Intelligence Unit, the Tanzania Revenue
          Authority, and the Bank of Tanzania, where lawful and required. By using the Service you
          consent to such checks and disclosures to the extent permitted by law.
        </p>
      </Section>

      <Section n={8} title="Subscriptions, trials, billing, and refunds">
        <p>
          The Service offers a free tier, a time-limited Pro trial, and paid Pro subscriptions. By
          starting a paid subscription you authorise PesaLens (and its payment processors, including
          mobile-money operators where applicable) to charge the recurring fee disclosed at
          checkout, on the renewal cadence disclosed at checkout, until you cancel.
        </p>
        <Bullets items={[
          'Trials automatically convert to paid plans at the end of the trial period unless cancelled before renewal.',
          'Fees are quoted inclusive or exclusive of VAT as displayed at checkout. VAT, withholding tax, and other applicable taxes are your responsibility unless we explicitly collect them.',
          'Subscription fees are non-refundable for partial billing periods, except where required by mandatory consumer-protection law.',
          'You may cancel from the Profile / Upgrade screen at any time; cancellation takes effect at the end of the current billing period.',
          "We may change pricing on at least 30 days' written notice, sent to the email address on file. Continuing to use the Service after the effective date constitutes acceptance.",
          'Failed payments may result in immediate downgrade to the free tier and read-only access to your data.',
        ]} />
      </Section>

      <Section n={9} title="Third-party data and services">
        <p>
          The Service integrates with third-party data sources (market data, FX rates, exchange
          feeds, model providers, hosting, email, and payment processors). Third-party data is
          provided &ldquo;as is&rdquo; by the third party. PesaLens does not warrant the accuracy,
          completeness, or timeliness of third-party data and is not liable for any third-party
          error, outage, delay, or change in terms.
        </p>
      </Section>

      <Section n={10} title="Intellectual property">
        <p>
          The Service, including its software, models, prompts, design, brand, copy, illustrations,
          charts, and documentation, is owned by PesaLens or its licensors and is protected by
          copyright, trademark, trade-secret, and other intellectual property laws. We grant you a
          personal, limited, revocable, non-exclusive, non-transferable licence to use the Service
          strictly in accordance with these Terms. All rights not expressly granted are reserved.
        </p>
      </Section>

      <Section n={11} title="Disclaimer of warranties">
        <p>
          <strong className="text-txt-1">The Service is provided &ldquo;as is&rdquo; and &ldquo;as
          available&rdquo;, without warranty of any kind</strong>, whether express, implied,
          statutory, or otherwise, to the fullest extent permitted by law. We disclaim all implied
          warranties including merchantability, fitness for a particular purpose, non-infringement,
          accuracy, uninterrupted operation, and availability. We do not warrant that the Service
          will be error-free, secure, or that defects will be corrected.
        </p>
      </Section>

      <Section n={12} title="Limitation of liability">
        <p>
          To the maximum extent permitted by law, in no event will PesaLens, its affiliates,
          directors, officers, employees, agents, or licensors be liable to you for any: (a)
          indirect, incidental, special, consequential, exemplary, or punitive damages; (b) loss of
          profits, revenue, business, goodwill, savings, data, opportunity, or expected investment
          returns; (c) trading or investment losses; (d) tax penalties or regulatory fines; or (e)
          damages arising from third-party services, even if advised of the possibility of such
          damages.
        </p>
        <p>
          Our aggregate liability to you for all claims relating to the Service in any twelve-month
          period will not exceed the greater of (i) the total fees you paid to PesaLens for the
          Service in that period, or (ii) USD 50. Some jurisdictions do not allow certain
          limitations; in those jurisdictions our liability is limited to the smallest amount
          permitted by law.
        </p>
      </Section>

      <Section n={13} title="Indemnification">
        <p>
          You will defend, indemnify, and hold harmless PesaLens and its affiliates, directors,
          officers, employees, and agents from and against any claim, demand, loss, liability,
          damage, or expense (including reasonable legal fees) arising out of or relating to: (a)
          your User Content; (b) your use or misuse of the Service; (c) your violation of these
          Terms; or (d) your violation of any law or third-party right.
        </p>
      </Section>

      <Section n={14} title="Suspension and termination">
        <p>
          We may suspend or terminate your access at any time, with or without notice, if we
          reasonably believe you have violated these Terms, are using the Service unlawfully, are
          creating risk for us or other users, or have not paid amounts due. You may stop using the
          Service and delete your account at any time from Settings → Delete account. Sections 4–6,
          10–13, 15–17, and any other clause that by its nature should survive, will survive
          termination.
        </p>
      </Section>

      <Section n={15} title="Governing law and dispute resolution">
        <p>
          These Terms are governed by the laws of the {JURISDICTION}, without regard to its
          conflict-of-laws rules. You and PesaLens agree to first attempt in good faith to resolve
          any dispute by negotiation for thirty (30) days. If unresolved, disputes will be submitted
          to the exclusive jurisdiction of the {COURTS}, save that PesaLens may seek injunctive or
          equitable relief in any court of competent jurisdiction.
        </p>
      </Section>

      <Section n={16} title="Changes to these Terms">
        <p>
          We may update these Terms from time to time. Material changes will be communicated via the
          Service or by email at least 14 days before they take effect. Continued use of the Service
          after the effective date constitutes acceptance. If you do not agree, you must stop using
          the Service before the effective date.
        </p>
      </Section>

      <Section n={17} title="Miscellaneous">
        <p>
          These Terms (together with our Privacy Policy and any plan-specific terms shown at
          checkout) are the entire agreement between you and PesaLens regarding the Service. If any
          provision is held unenforceable, the remaining provisions remain in full force. Our
          failure to enforce a right is not a waiver. You may not assign these Terms; we may assign
          them to an affiliate or in connection with a merger, acquisition, or sale of assets.
          Notices to you may be given by email or in-app message; notices to us must be sent to{' '}
          <Mail address={CONTACT_EMAIL} />.
        </p>
      </Section>

      <Section n={18} title="Contact">
        <p>
          Questions about these Terms? Email <Mail address={CONTACT_EMAIL} />. For account or
          product help, email <Mail address={SUPPORT_EMAIL} />.
        </p>
      </Section>

      <div className="mt-12 pt-8 border-t border-bdr text-center">
        <Eyebrow>Also see</Eyebrow>
        <div className="mt-3 flex items-center justify-center gap-4">
          <Link to="/privacy" className="text-sm font-medium text-accent hover:underline">
            Privacy Policy
          </Link>
          <span className="text-txt-4">·</span>
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-sm font-medium text-accent hover:underline">
            Contact legal
          </a>
        </div>
        <p className="mt-6 text-[10px] font-mono uppercase tracking-ticker text-txt-3">
          PesaLens · {EFFECTIVE_DATE}
        </p>
      </div>
    </div>
  </div>
);

export default TermsPage;
