import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ScrollText } from "lucide-react";
import { Eyebrow } from "@/components/pl/primitives";

const EFFECTIVE_DATE = "10 May 2026";
const COMPANY_LEGAL = "PesaLens";
const CONTACT_EMAIL = "legal@pesalens.com";
const SUPPORT_EMAIL = "support@pesalens.com";
const JURISDICTION = "United Republic of Tanzania";
const COURTS = "courts of Dar es Salaam, Tanzania";

const Section = ({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) => (
  <section className="space-y-2">
    <h2 className="text-[15px] font-bold tracking-tight">
      <span className="text-txt-3 font-mono-tab text-[12px] mr-2">{String(n).padStart(2, "0")}</span>
      {title}
    </h2>
    <div className="text-[13px] text-txt-2 leading-relaxed space-y-2">{children}</div>
  </section>
);

const Terms = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-deep">
      <div className="pt-safe bg-deep" />
      <header className="sticky top-0 z-30 px-4 py-3 flex items-center gap-3 glass-pane border-b border-border/50">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full bg-surface-2 border border-border/60 flex items-center justify-center"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <Eyebrow>Legal</Eyebrow>
          <div className="text-[15px] font-bold tracking-tight">Terms of Service</div>
        </div>
        <ScrollText className="w-4 h-4 text-txt-3" />
      </header>

      <article className="px-5 py-6 max-w-[640px] mx-auto pb-16">
        <p className="text-[11px] font-mono-tab uppercase tracking-ticker text-txt-3">
          Effective {EFFECTIVE_DATE}
        </p>
        <h1 className="text-[24px] font-bold tracking-tight mt-2 leading-tight">
          PesaLens Terms of Service
        </h1>
        <p className="text-[13px] text-txt-2 leading-relaxed mt-3">
          These Terms of Service ("<strong>Terms</strong>") form a binding agreement between you
          ("<strong>you</strong>", "<strong>your</strong>", "<strong>User</strong>") and {COMPANY_LEGAL}
          ("<strong>PesaLens</strong>", "<strong>we</strong>", "<strong>us</strong>", "<strong>our</strong>")
          governing your access to and use of the PesaLens mobile application, web application,
          APIs, and related services (collectively, the "<strong>Service</strong>"). By creating an
          account, signing in, uploading a statement, or otherwise using the Service, you
          confirm that you have read, understood, and accepted these Terms and our{" "}
          <Link to="/privacy" className="text-accent font-semibold">Privacy Policy</Link>.
          If you do not agree, do not use the Service.
        </p>

        <div className="hairline my-6" />

        <div className="space-y-6">
          <Section n={1} title="The Service — what PesaLens is, and what it is not">
            <p>
              PesaLens is a personal-finance and bookkeeping tool that ingests bank and
              mobile-money statements, reconstructs your transaction ledger, categorises
              spending, and surfaces analytics. It is an <strong>informational tool only</strong>.
            </p>
            <p>
              PesaLens is <strong>not</strong> a bank, broker, dealer, payment service provider,
              electronic money issuer, money-transfer agent, custodian, investment adviser,
              tax adviser, accountant, or law firm. We do not hold, move, lend, invest, or
              custody money for you. We do not execute trades. We do not give personalised
              investment, tax, accounting, or legal advice.
            </p>
            <p>
              Any market data, indicator, score, projection, "recommendation", or commentary
              shown in the Service is for educational and informational purposes only and is
              not an offer, solicitation, or recommendation to buy, sell, or hold any
              security, currency, asset, or financial product. <strong>You are solely
              responsible</strong> for any financial, investment, tax, or business decision you
              make. Always consult a licensed professional before acting.
            </p>
          </Section>

          <Section n={2} title="Eligibility">
            <p>To use the Service you confirm that:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>You are at least 18 years old, or the legal age of majority in your jurisdiction, whichever is higher.</li>
              <li>You have full legal capacity to enter into a binding contract.</li>
              <li>You are not prohibited from using the Service under any applicable law, including sanctions, anti-money-laundering ("AML"), or counter-terrorism-financing ("CTF") regulations.</li>
              <li>If you use the Service on behalf of a business, you are authorised to bind that business and accept these Terms on its behalf.</li>
            </ul>
            <p>
              We may, at our sole discretion, refuse to provide the Service to anyone for any
              lawful reason, including failure to satisfy the above.
            </p>
          </Section>

          <Section n={3} title="Your account and credentials">
            <p>
              You must provide accurate, current, and complete information when creating your
              account, and keep that information up to date. You are responsible for all
              activity under your account, including activity by anyone you allow to access
              your device, email inbox, or one-time password.
            </p>
            <p>
              You agree to: (a) keep your password confidential; (b) not share your account or
              session token with anyone; (c) sign out from shared devices; and (d) notify us
              immediately at <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent">{SUPPORT_EMAIL}</a> of
              any unauthorised access or suspected breach. We are not liable for losses caused
              by your failure to safeguard your credentials.
            </p>
          </Section>

          <Section n={4} title="Statements, content, and your data licence to us">
            <p>
              When you upload a bank or mobile-money statement, receipt, ledger entry, or any
              other content ("<strong>User Content</strong>"), you confirm that:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>The User Content belongs to you, or you have all rights, consents, and authority required to upload and process it.</li>
              <li>Uploading and processing the User Content does not violate any law, contract, bank/operator terms, or third-party rights.</li>
              <li>The User Content does not contain malware, illegal content, or content that infringes intellectual-property or privacy rights of others.</li>
            </ul>
            <p>
              You grant PesaLens a worldwide, non-exclusive, royalty-free licence to host, copy,
              transmit, parse, transform, store, and process your User Content strictly for the
              purpose of providing the Service to you, improving extraction accuracy, securing
              the platform, complying with law, and producing aggregated, de-identified
              analytics. We do not sell your raw User Content or use it to train third-party
              foundation models on identifiable data. You retain ownership of your User Content.
            </p>
          </Section>

          <Section n={5} title="Accuracy disclaimer — verify before you act">
            <p>
              Statement extraction relies on OCR, layout heuristics, and machine-learning
              models. Despite our best efforts, the Service may misclassify, misread, omit, or
              duplicate transactions, fees, balances, dates, or counter-parties — particularly
              where the source PDF is scanned, low-quality, password-protected, multilingual,
              or in a non-standard format.
            </p>
            <p>
              <strong>You must independently verify</strong> any number, ledger, balance, tax
              figure, KPI, P&amp;L line, or insight produced by the Service against your
              official bank, mobile-money, or accounting records before relying on it for any
              financial, business, tax, or legal purpose. PesaLens is not a substitute for an
              accountant, auditor, or qualified adviser.
            </p>
          </Section>

          <Section n={6} title="Acceptable use">
            <p>You agree not to, and not to attempt to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Upload content you do not own or are not authorised to process.</li>
              <li>Use the Service for money laundering, terrorist financing, sanctions evasion, fraud, tax evasion, or any other unlawful purpose.</li>
              <li>Reverse-engineer, decompile, scrape, or attempt to extract source code, model weights, or proprietary heuristics from the Service, except to the extent expressly permitted by law.</li>
              <li>Probe, scan, stress-test, or attempt to bypass authentication, rate-limits, or security controls.</li>
              <li>Use the Service to build a competing product, or to train or fine-tune a competing model.</li>
              <li>Resell, sublicense, white-label, or commercially redistribute the Service without our prior written consent.</li>
              <li>Upload viruses, exploits, or malicious code.</li>
              <li>Impersonate any person or entity, or misrepresent your affiliation.</li>
            </ul>
            <p>
              We reserve the right to investigate suspected violations and to suspend or
              terminate offending accounts without prior notice.
            </p>
          </Section>

          <Section n={7} title="AML, KYC, and reporting">
            <p>
              PesaLens may be required by applicable AML/CTF, sanctions, and tax-reporting
              laws — including those of the {JURISDICTION} — to verify user identity, monitor
              suspicious activity, freeze accounts, retain records, and report transactions or
              user information to competent authorities including the Financial Intelligence
              Unit, the Tanzania Revenue Authority, and the Bank of Tanzania, where lawful and
              required. By using the Service you consent to such checks and disclosures to the
              extent permitted by law.
            </p>
          </Section>

          <Section n={8} title="Subscriptions, trials, billing, and refunds">
            <p>
              The Service offers a free tier, a time-limited Pro trial, and paid Pro
              subscriptions. By starting a paid subscription you authorise PesaLens (and its
              payment processors, including mobile-money operators where applicable) to charge
              the recurring fee disclosed at checkout, on the renewal cadence disclosed at
              checkout, until you cancel.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Trials automatically convert to paid plans at the end of the trial period unless cancelled before renewal.</li>
              <li>Fees are quoted inclusive or exclusive of VAT as displayed at checkout. VAT, withholding tax, and other applicable taxes are your responsibility unless we explicitly collect them.</li>
              <li>Subscription fees are <strong>non-refundable</strong> for partial billing periods, except where required by mandatory consumer-protection law.</li>
              <li>You may cancel from the Profile / Upgrade screen at any time; cancellation takes effect at the end of the current billing period.</li>
              <li>We may change pricing on at least 30 days' written notice, sent to the email address on file. Continuing to use the Service after the effective date constitutes acceptance.</li>
              <li>Failed payments may result in immediate downgrade to the free tier and read-only access to your data.</li>
            </ul>
          </Section>

          <Section n={9} title="Third-party data and services">
            <p>
              The Service integrates with third-party data sources (market data, FX rates,
              exchange feeds, model providers, hosting, email, and payment processors).
              Third-party data is provided "as is" by the third party. PesaLens does not
              warrant the accuracy, completeness, or timeliness of third-party data and is not
              liable for any third-party error, outage, delay, or change in terms.
            </p>
          </Section>

          <Section n={10} title="Intellectual property">
            <p>
              The Service, including its software, models, prompts, design, brand, copy,
              illustrations, charts, and documentation, is owned by PesaLens or its licensors
              and is protected by copyright, trademark, trade-secret, and other intellectual
              property laws. We grant you a personal, limited, revocable, non-exclusive,
              non-transferable licence to use the Service strictly in accordance with these
              Terms. All rights not expressly granted are reserved.
            </p>
          </Section>

          <Section n={11} title="Disclaimer of warranties">
            <p>
              <strong>The Service is provided "as is" and "as available", without warranty of
              any kind</strong>, whether express, implied, statutory, or otherwise, to the
              fullest extent permitted by law. We disclaim all implied warranties including
              merchantability, fitness for a particular purpose, non-infringement, accuracy,
              uninterrupted operation, and availability. We do not warrant that the Service
              will be error-free, secure, or that defects will be corrected.
            </p>
          </Section>

          <Section n={12} title="Limitation of liability">
            <p>
              To the maximum extent permitted by law, in no event will PesaLens, its
              affiliates, directors, officers, employees, agents, or licensors be liable to
              you for any: (a) indirect, incidental, special, consequential, exemplary, or
              punitive damages; (b) loss of profits, revenue, business, goodwill, savings,
              data, opportunity, or expected investment returns; (c) trading or investment
              losses; (d) tax penalties or regulatory fines; or (e) damages arising from
              third-party services, even if advised of the possibility of such damages.
            </p>
            <p>
              Our aggregate liability to you for all claims relating to the Service in any
              twelve-month period will not exceed the greater of (i) the total fees you paid
              to PesaLens for the Service in that period, or (ii) USD 50. Some jurisdictions
              do not allow certain limitations; in those jurisdictions our liability is
              limited to the smallest amount permitted by law.
            </p>
          </Section>

          <Section n={13} title="Indemnification">
            <p>
              You will defend, indemnify, and hold harmless PesaLens and its affiliates,
              directors, officers, employees, and agents from and against any claim, demand,
              loss, liability, damage, or expense (including reasonable legal fees) arising
              out of or relating to: (a) your User Content; (b) your use or misuse of the
              Service; (c) your violation of these Terms; or (d) your violation of any law or
              third-party right.
            </p>
          </Section>

          <Section n={14} title="Suspension and termination">
            <p>
              We may suspend or terminate your access at any time, with or without notice,
              if we reasonably believe you have violated these Terms, are using the Service
              unlawfully, are creating risk for us or other users, or have not paid amounts
              due. You may stop using the Service and delete your account at any time from
              Profile → Delete account. Sections 4–6, 10–13, 15–17, and any other clause that
              by its nature should survive, will survive termination.
            </p>
          </Section>

          <Section n={15} title="Governing law and dispute resolution">
            <p>
              These Terms are governed by the laws of the {JURISDICTION}, without regard to
              its conflict-of-laws rules. You and PesaLens agree to first attempt in good
              faith to resolve any dispute by negotiation for thirty (30) days. If
              unresolved, disputes will be submitted to the exclusive jurisdiction of the
              {" "}{COURTS}, save that PesaLens may seek injunctive or equitable relief in any
              court of competent jurisdiction.
            </p>
          </Section>

          <Section n={16} title="Changes to these Terms">
            <p>
              We may update these Terms from time to time. Material changes will be
              communicated via the Service or by email at least 14 days before they take
              effect. Continued use of the Service after the effective date constitutes
              acceptance. If you do not agree, you must stop using the Service before the
              effective date.
            </p>
          </Section>

          <Section n={17} title="Miscellaneous">
            <p>
              These Terms (together with our Privacy Policy and any plan-specific terms shown
              at checkout) are the entire agreement between you and PesaLens regarding the
              Service. If any provision is held unenforceable, the remaining provisions
              remain in full force. Our failure to enforce a right is not a waiver. You may
              not assign these Terms; we may assign them to an affiliate or in connection
              with a merger, acquisition, or sale of assets. Notices to you may be given by
              email or in-app message; notices to us must be sent to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent">{CONTACT_EMAIL}</a>.
            </p>
          </Section>

          <Section n={18} title="Contact">
            <p>
              Questions about these Terms? Email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent">{CONTACT_EMAIL}</a>.
              For account or product help, email{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent">{SUPPORT_EMAIL}</a>.
            </p>
          </Section>
        </div>

        <div className="hairline my-8" />

        <div className="text-center">
          <Eyebrow>Also see</Eyebrow>
          <div className="mt-3 flex items-center justify-center gap-4">
            <Link to="/privacy" className="text-[13px] font-semibold text-accent">
              Privacy Policy
            </Link>
            <span className="text-txt-4">·</span>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-[13px] font-semibold text-accent"
            >
              Contact legal
            </a>
          </div>
          <p className="mt-6 text-[10px] font-mono-tab uppercase tracking-ticker text-txt-3">
            PesaLens · {EFFECTIVE_DATE}
          </p>
        </div>
      </article>
    </div>
  );
};

export default Terms;
