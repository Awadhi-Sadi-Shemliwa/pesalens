import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Eyebrow } from "@/components/pl/primitives";

const EFFECTIVE_DATE = "10 May 2026";
const CONTROLLER = "PesaLens";
const CONTACT_EMAIL = "privacy@pesalens.com";
const DPO_EMAIL = "dpo@pesalens.com";

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

const Privacy = () => {
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
          <div className="text-[15px] font-bold tracking-tight">Privacy Policy</div>
        </div>
        <ShieldCheck className="w-4 h-4 text-txt-3" />
      </header>

      <article className="px-5 py-6 max-w-[640px] mx-auto pb-16">
        <p className="text-[11px] font-mono-tab uppercase tracking-ticker text-txt-3">
          Effective {EFFECTIVE_DATE}
        </p>
        <h1 className="text-[24px] font-bold tracking-tight mt-2 leading-tight">
          PesaLens Privacy Policy
        </h1>
        <p className="text-[13px] text-txt-2 leading-relaxed mt-3">
          {CONTROLLER} ("<strong>we</strong>", "<strong>us</strong>") respects your privacy. This
          Privacy Policy explains what personal data we collect, how we use it, who we share
          it with, how long we keep it, and the rights you have. It is part of, and
          incorporated into, our{" "}
          <Link to="/terms" className="text-accent font-semibold">Terms of Service</Link>.
        </p>

        <div className="hairline my-6" />

        <div className="space-y-6">
          <Section n={1} title="Who is the controller">
            <p>
              {CONTROLLER} acts as the data controller for the personal data you submit to
              the Service. You can contact us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent">{CONTACT_EMAIL}</a>{" "}
              or our Data Protection Officer at{" "}
              <a href={`mailto:${DPO_EMAIL}`} className="text-accent">{DPO_EMAIL}</a>.
            </p>
          </Section>

          <Section n={2} title="What personal data we collect">
            <p>We collect the following categories of personal data:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Account data</strong> — full name, email address, hashed password,
                account type (personal / business), authentication tokens, login timestamps,
                IP address, device and browser information.
              </li>
              <li>
                <strong>Statement data</strong> — bank and mobile-money statements you upload,
                and the transactions, balances, fees, counter-parties, dates, and references
                we extract from them.
              </li>
              <li>
                <strong>Bookkeeping data</strong> — receipts, ledger entries, business
                metadata, and any notes or categories you create.
              </li>
              <li>
                <strong>Billing data</strong> — subscription plan, billing history, last four
                digits of payment instrument, mobile-money confirmation references. We do not
                store full card numbers — those are tokenised by our payment processor.
              </li>
              <li>
                <strong>Usage data</strong> — pages viewed, features used, click and scroll
                events, error logs, performance telemetry. We use this to improve the
                Service and detect abuse.
              </li>
              <li>
                <strong>Support data</strong> — messages you send to us and our replies.
              </li>
            </ul>
          </Section>

          <Section n={3} title="How we use your data and our legal basis">
            <p>We use your personal data to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Provide, maintain, and improve the Service (contractual necessity).</li>
              <li>Authenticate you, secure your account, prevent fraud and abuse (legitimate interest, legal obligation).</li>
              <li>Extract, categorise, and analyse statements you upload (contractual necessity).</li>
              <li>Process payments, manage subscriptions, issue receipts (contractual necessity, legal obligation).</li>
              <li>Communicate with you about your account, security, and service updates (contractual necessity).</li>
              <li>Send marketing communications where you have opted in (consent — you can withdraw at any time).</li>
              <li>Comply with AML/CTF, sanctions, tax, and other applicable legal obligations.</li>
              <li>Defend or pursue legal claims (legitimate interest).</li>
            </ul>
          </Section>

          <Section n={4} title="Sensitive financial data and security">
            <p>
              Bank and mobile-money statements contain sensitive financial information. We
              treat this data with elevated care:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>All traffic between your device and our servers is encrypted in transit (TLS 1.2+).</li>
              <li>Stored data is encrypted at rest on managed cloud infrastructure.</li>
              <li>Passwords are hashed with industry-standard algorithms (bcrypt). We never see your plain-text password.</li>
              <li>Access to production data is restricted to a small number of authorised engineers, on a need-to-know basis, and is logged.</li>
              <li>Uploaded PDFs are <strong>deleted from our servers after extraction</strong>; only the structured transactions and your derived ledger remain in your account.</li>
              <li>We do not sell your data, and we do not allow third-party advertising trackers inside the Service.</li>
            </ul>
            <p>
              No system is perfectly secure. If we discover a personal-data breach affecting
              you, we will notify you and the relevant supervisory authority where required
              by law.
            </p>
          </Section>

          <Section n={5} title="Who we share data with">
            <p>We share personal data only with:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Service providers</strong> who process data on our behalf under
                written contracts and confidentiality obligations — cloud hosting, database,
                email delivery, error monitoring, payment processing, and language-model
                providers used to improve extraction and to power the assistant. These
                providers are bound to use the data only to deliver the contracted service.
              </li>
              <li>
                <strong>Authorities</strong> when we are legally required, including in
                response to valid court orders, AML/CTF requests, tax enquiries, or sanctions
                checks, and to protect our or others' legal rights.
              </li>
              <li>
                <strong>Successors</strong> in the event of a merger, acquisition, or
                reorganisation, subject to confidentiality and an equivalent privacy
                commitment.
              </li>
            </ul>
            <p>
              We do <strong>not</strong> sell your personal data, and we do not share your
              raw User Content with advertisers, data brokers, or third parties for their own
              marketing purposes.
            </p>
          </Section>

          <Section n={6} title="International transfers">
            <p>
              Some of our service providers may be located outside the {CONTROLLER}'s primary
              country of operation. Where we transfer personal data internationally, we
              ensure an appropriate level of protection through contractual safeguards
              (including standard contractual clauses where applicable) and assess the
              receiving jurisdiction's protections.
            </p>
          </Section>

          <Section n={7} title="Data retention">
            <p>
              We keep your personal data only as long as we need to provide the Service, to
              comply with law, or to defend legal claims. Indicative retention periods:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Account and profile data — for the life of your account, then up to 30 days after deletion (longer where required by law).</li>
              <li>Uploaded PDFs — deleted immediately after extraction.</li>
              <li>Extracted transactions, ledger entries, and receipts — for the life of your account, then deleted on account deletion subject to legal hold.</li>
              <li>Billing records and tax invoices — for the period required by Tanzanian tax law (currently a minimum of five years).</li>
              <li>Security and audit logs — up to 12 months.</li>
            </ul>
          </Section>

          <Section n={8} title="Your rights">
            <p>Subject to applicable law, you have the right to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Access</strong> the personal data we hold about you.</li>
              <li><strong>Rectify</strong> inaccurate or incomplete data.</li>
              <li><strong>Erase</strong> your account and personal data ("right to be forgotten") — available in-app at Profile → Delete account.</li>
              <li><strong>Export</strong> your data in a portable format — available in-app at Profile → Export my data.</li>
              <li><strong>Restrict</strong> or <strong>object to</strong> certain processing.</li>
              <li><strong>Withdraw consent</strong> for marketing or any processing based on consent, at any time.</li>
              <li><strong>Lodge a complaint</strong> with the competent supervisory authority, including the Personal Data Protection Commission of Tanzania.</li>
            </ul>
            <p>
              To exercise these rights, email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent">{CONTACT_EMAIL}</a>.
              We may need to verify your identity before responding. We will respond within
              30 days, or as required by law.
            </p>
          </Section>

          <Section n={9} title="Automated processing">
            <p>
              We use automated systems and machine-learning models to extract data from
              statements, classify transactions, detect fraud and abuse, and generate
              insights. These tools assist our service and do not produce decisions with
              significant legal effect on you. You can always contact us to ask how an
              automated result was produced and to request a human review.
            </p>
          </Section>

          <Section n={10} title="Children">
            <p>
              The Service is not directed at children. We do not knowingly collect personal
              data from anyone under 18. If you believe a child has provided us personal
              data, please contact us and we will delete it.
            </p>
          </Section>

          <Section n={11} title="Cookies and similar technologies">
            <p>
              The web app uses essential cookies and local storage to keep you signed in,
              remember your theme and language, and persist app settings. We do not use
              third-party advertising cookies. You can clear local storage at any time from
              your browser; doing so will sign you out.
            </p>
          </Section>

          <Section n={12} title="Changes to this Policy">
            <p>
              We may update this Privacy Policy. Material changes will be communicated via
              the Service or by email at least 14 days before they take effect. The
              "Effective" date at the top tells you when the current version came into force.
            </p>
          </Section>

          <Section n={13} title="Contact">
            <p>
              Privacy questions, requests, and complaints:{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent">{CONTACT_EMAIL}</a>.
              Data Protection Officer:{" "}
              <a href={`mailto:${DPO_EMAIL}`} className="text-accent">{DPO_EMAIL}</a>.
            </p>
          </Section>
        </div>

        <div className="hairline my-8" />

        <div className="text-center">
          <Eyebrow>Also see</Eyebrow>
          <div className="mt-3 flex items-center justify-center gap-4">
            <Link to="/terms" className="text-[13px] font-semibold text-accent">
              Terms of Service
            </Link>
            <span className="text-txt-4">·</span>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-[13px] font-semibold text-accent"
            >
              Contact privacy
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

export default Privacy;
