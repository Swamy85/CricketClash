import "./ContactUsPage.css";

const contacts = [
  {
    label: "Email",
    value: "kotariswamy1@gmail.com",
    href: "mailto:kotariswamy1@gmail.com",
    icon: "✉",
    action: "Send an email",
  },
  {
    label: "Call",
    value: "8341929472",
    href: "tel:+918341929472",
    icon: "☎",
    action: "Call support",
  },
  {
    label: "WhatsApp",
    value: "8341929472",
    href: "https://wa.me/918341929472",
    icon: "◉",
    action: "Open WhatsApp chat",
    external: true,
  },
];

const faqs = [
  {
    question: "How do I check a deposit request?",
    answer: "Open Wallet and review your deposit history to see the latest request status.",
  },
  {
    question: "Where can I check my withdrawal?",
    answer: "Your withdrawal request and its current status are available in the Wallet section.",
  },
  {
    question: "How do contests work?",
    answer: "Choose an upcoming match, open an available contest, and select one of its two teams. Each contest is a head-to-head entry.",
  },
  {
    question: "When are match results confirmed?",
    answer: "Contest outcomes follow the verified match result recorded in CricketClash. You can review results and settlement details in Contest activity.",
  },
  {
    question: "How do I update my account or reset my password?",
    answer: "Manage your account from Profile. If you cannot sign in, use Forgot Password on the login page to reset your password by email.",
  },
];

export default function ContactUsPage() {
  return (
    <section className="cc-feature-page cc-contact-page">
      <header className="cc-feature-heading cc-contact-heading">
        <div>
          <span className="cc-feature-eyebrow">WE’RE HERE TO HELP</span>
          <h1>Contact Us</h1>
          <p>Reach the CricketClash support team using the contact option that works for you.</p>
        </div>
        <div className="cc-contact-availability" role="status">
          <span className="cc-contact-online-dot" />
          <strong>Support available 24/7</strong>
        </div>
      </header>

      <div className="cc-contact-options" aria-label="Contact options">
        {contacts.map((contact) => (
          <a
            className="cc-contact-option"
            href={contact.href}
            key={contact.label}
            target={contact.external ? "_blank" : undefined}
            rel={contact.external ? "noreferrer" : undefined}
          >
            <span className="cc-contact-option-icon" aria-hidden="true">{contact.icon}</span>
            <span className="cc-contact-option-copy">
              <span>{contact.label}</span>
              <strong>{contact.value}</strong>
              <small>{contact.action} <span aria-hidden="true">→</span></small>
            </span>
          </a>
        ))}
      </div>

      <section className="cc-contact-faq" aria-labelledby="cc-contact-faq-title">
        <div className="cc-contact-faq-heading">
          <span className="cc-feature-eyebrow">QUICK ANSWERS</span>
          <h2 id="cc-contact-faq-title">Frequently asked questions</h2>
          <p>Find help with common account, wallet, and contest questions.</p>
        </div>
        <div className="cc-contact-faq-list">
          {faqs.map((faq) => (
            <details className="cc-contact-faq-item" key={faq.question}>
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </section>
  );
}
