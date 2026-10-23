
import { Link, useLocation } from "react-router-dom";
import "../styles/info-page.css";

const pages = {
  "/terms": {
    eyebrow: "THE RULES",
    title: "Terms of Service",
    intro:
      "These terms explain the rules for using CricketClash. Please read them before creating an account or participating in any contest.",
    sections: [
      {
        title: "1. About CricketClash",
        paragraphs: [
          "CricketClash is being developed as a cricket-focused platform featuring head-to-head contests. Available features may change as the platform develops.",
          "The platform's actual services, contest formats, fees and prizes will be described before they become available."
        ]
      },
      {
        title: "2. Accounts and eligibility",
        paragraphs: [
          "You must provide accurate registration information, keep your login credentials secure and use only your own account.",
          "You may use restricted contest features only if you meet the applicable age, location and other eligibility requirements. Some features may not be available in every jurisdiction."
        ]
      },
      {
        title: "3. Contest participation",
        paragraphs: [
          "Read the rules, entry requirements, scoring method, contest duration and any applicable fees before joining a contest.",
          "Do not use multiple accounts, automated methods, collusion, false information or other unfair methods to manipulate contest outcomes."
        ]
      },
      {
        title: "4. Fees, prizes and payments",
        paragraphs: [
          "Any entry fee, platform fee, prize, payment method, withdrawal process or refund policy must be clearly disclosed in the relevant contest terms before participation.",
          "Do not assume that a contest offers cash prizes or that a payment or withdrawal feature is available unless it is explicitly shown and operational."
        ]
      },
      {
        title: "5. Fair use and account action",
        paragraphs: [
          "Attempts to compromise the platform, interfere with other users, abuse a feature or violate contest rules may lead to an investigation or account restrictions, subject to applicable law and the platform's published procedures."
        ]
      },
      {
        title: "6. Availability and changes",
        paragraphs: [
          "We may update, suspend or discontinue features for maintenance, security, operational or legal reasons. Where appropriate, material changes and their effective dates will be communicated."
        ]
      },
      {
        title: "7. Legal compliance",
        paragraphs: [
          "You are responsible for complying with laws that apply to your use of the platform. CricketClash must not be used where a particular contest or feature is prohibited.",
          "These draft terms are not a statement that every planned contest format is lawful in every location. Final terms should be reviewed for the jurisdictions in which the service operates."
        ]
      },
      {
        title: "8. Contact and updates",
        paragraphs: [
          "A verified support contact and the effective date of these terms should be published before the platform launches. These draft terms should be reviewed and finalized before being treated as a binding agreement."
        ]
      }
    ]
  },

  "/privacy": {
    eyebrow: "YOUR INFORMATION",
    title: "Privacy Policy",
    intro:
      "This page explains the categories of information CricketClash may handle and how privacy should be protected as the service develops.",
    sections: [
      {
        title: "1. Information you provide",
        paragraphs: [
          "Registration may require a username, email address and password. Email verification may use a one-time verification code.",
          "Do not submit information that a feature does not reasonably need."
        ]
      },
      {
        title: "2. Account and technical information",
        paragraphs: [
          "Depending on the features implemented, the service may process account identifiers, authentication and session records, security logs, contest activity and basic technical information needed to operate and protect the platform.",
          "The final policy must accurately describe what the deployed application and its providers actually collect."
        ]
      },
      {
        title: "3. How information may be used",
        paragraphs: [
          "Information may be used to create and secure accounts, verify email addresses, provide requested features, prevent abuse, troubleshoot problems and meet applicable legal obligations."
        ]
      },
      {
        title: "4. Service providers and sharing",
        paragraphs: [
          "Information may be processed by service providers used to host the application, store data or deliver verification emails, where those providers are actually used.",
          "The final policy should identify relevant providers and explain when information may be shared with them or disclosed to comply with law."
        ]
      },
      {
        title: "5. Passwords and security",
        paragraphs: [
          "Passwords should be stored using an appropriate password-hashing method, never as readable plain text. Authentication secrets and verification codes should be protected.",
          "Reasonable security measures help reduce risk but cannot guarantee absolute security."
        ]
      },
      {
        title: "6. Retention and deletion",
        paragraphs: [
          "Information should be retained only as long as needed for the stated purposes, security, dispute handling or legal obligations. The final policy must explain the actual deletion process and any applicable exceptions."
        ]
      },
      {
        title: "7. Your choices and rights",
        paragraphs: [
          "Depending on applicable law, you may have rights to request access, correction, deletion or other action regarding your personal information.",
          "A verified privacy contact and a practical way to submit requests must be provided before launch."
        ]
      },
      {
        title: "8. Policy changes",
        paragraphs: [
          "The final published policy should include its effective date, the applicable legal entity or operator, relevant service-provider details and how material updates will be communicated."
        ]
      }
    ]
  },

  "/responsible-play": {
    eyebrow: "PLAY RESPONSIBLY",
    title: "Responsible Play",
    intro:
      "Cricket should be enjoyable. Understand the rules, protect your finances and take a break whenever participation stops feeling healthy.",
    sections: [
      {
        title: "1. Understand the contest",
        paragraphs: [
          "Read the contest format, scoring rules, entry requirements and outcome conditions before participating. Never assume a particular result or prize is guaranteed."
        ]
      },
      {
        title: "2. Set personal limits",
        paragraphs: [
          "Decide in advance how much time and money, if any, you can comfortably afford to spend. Never use money needed for essentials, borrow to participate or chase losses.",
          "If you find it difficult to stop, take a break and seek help from someone you trust."
        ]
      },
      {
        title: "3. No guaranteed wins",
        paragraphs: [
          "Cricket outcomes and contest results can be uncertain. Past results do not guarantee future results, and no strategy can promise a win."
        ]
      },
      {
        title: "4. Age and location restrictions",
        paragraphs: [
          "Do not participate in a restricted contest unless you meet its published eligibility requirements. Age limits and local laws must be checked before any contest involving entry fees or prizes is enabled."
        ]
      },
      {
        title: "5. Protect your account",
        paragraphs: [
          "Keep your password private, do not share your account and report suspicious activity through the platform's published support channel."
        ]
      },
      {
        title: "6. Take a break",
        paragraphs: [
          "If participation affects your finances, relationships, sleep or wellbeing, stop and seek appropriate support. This page is informational and is not a substitute for professional advice."
        ]
      },
      {
        title: "7. Before contests launch",
        paragraphs: [
          "CricketClash should publish clear eligibility rules, any available spending or participation controls, complaint procedures and locally appropriate support resources before enabling relevant contests."
        ]
      }
    ]
  },

  "/support": {
    eyebrow: "WE'RE HERE TO HELP",
    title: "Support & FAQs",
    intro:
      "Find answers to common questions about CricketClash. The answers below describe the intended registration flow and should be updated if the implemented features change.",
    sections: [
      {
        title: "How do I create an account?",
        paragraphs: [
          "Open the Register page and enter the requested username, email address and password. Follow the on-screen instructions to complete registration."
        ]
      },
      {
        title: "How does email verification work?",
        paragraphs: [
          "CricketClash is designed to verify email addresses using a one-time code. Follow the instructions on the verification page and request a new code if the current code expires and that option is available."
        ]
      },
      {
        title: "I cannot log in. What should I do?",
        paragraphs: [
          "Check that your username and password are correct and that your account has completed any required verification. Never share your password or verification code with anyone."
        ]
      },
      {
        title: "Are live matches and contests available?",
        paragraphs: [
          "Illustrative matchups on the landing page are examples, not live fixtures. Live schedules, contest availability and participation features should be relied on only when they are explicitly displayed as active in the application."
        ]
      },
      {
        title: "Are prizes or payments available?",
        paragraphs: [
          "Do not assume that prizes, entry fees, deposits, withdrawals or refunds are available. Any enabled feature must display its applicable terms before you use it."
        ]
      },
      {
        title: "How can I contact support?",
        paragraphs: [
          "A verified support email address or support form needs to be published by the CricketClash operator. Until that contact method is configured, please do not rely on an unverified email address."
        ]
      },
      {
        title: "How can I report a security or privacy concern?",
        paragraphs: [
          "Use the official support or privacy contact once it is published. Avoid sending passwords, one-time codes or unnecessary sensitive information in a support request."
        ]
      }
    ]
  }
};

export default function InfoPage() {
  const { pathname } = useLocation();
  const page = pages[pathname.replace(/\/$/, "")] ?? pages["/support"];

  return (
    <main className="info-page">
      <div className="info-page-container">
        <div className="info-page-breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
          <span>{page.title}</span>
        </div>

        <header className="info-page-header">
          <span className="info-page-eyebrow">{page.eyebrow}</span>
          <h1>{page.title}</h1>
          <p>{page.intro}</p>
        </header>

        <div className="info-page-content">
          {page.sections.map((section) => (
            <section className="info-page-section" key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>

        <div className="info-page-back">
  <Link
    to="/"
    onClick={() => window.scrollTo(0, 0)}
  >
    ← Back to CricketClash
  </Link>
</div>
      </div>
    </main>
  );
}
