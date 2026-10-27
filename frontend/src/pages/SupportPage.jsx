
import { useState } from "react";
import { Link } from "react-router-dom";
import "../styles/support-page.css";

const initialForm = {
  name: "",
  email: "",
  category: "account",
  subject: "",
  message: "",
  website: "",
};

const faqs = [
  {
    question: "How do I create a CricketClash account?",
    answer:
      "Open Create Account, enter your username, email and password, and follow the email verification instructions.",
  },
  {
    question: "My email verification code expired. What should I do?",
    answer:
      "Return to the verification page and request another code if that option is available. Never share your verification code with anyone.",
  },
  {
    question: "I cannot log in. How can I get help?",
    answer:
      "Check your username and password, and confirm that email verification is complete. If the problem continues, select Login Issues in the contact form.",
  },
  {
    question: "Are the matches shown on the landing page live?",
    answer:
      "Illustrative matchups are examples only. Use match information only when the application explicitly identifies it as live and current.",
  },
  {
    question: "How do I report a privacy or security concern?",
    answer:
      "Select Privacy & Security in the form and describe the issue without including your password, OTP, or other unnecessary sensitive information.",
  },
];

export default function SupportPage() {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));

    setFieldErrors((current) => {
      if (!current[name]) return current;

      const next = { ...current };
      delete next[name];
      return next;
    });
    if (feedback) setFeedback(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFeedback(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      const apiBase = (
        import.meta.env.VITE_API_URL || "http://localhost:5000"
      ).replace(/\/+$/, "");

      const response = await fetch(`${apiBase}/api/support`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          name: form.name.trim(),
          email: form.email.trim(),
          category: form.category.trim(),
          subject: form.subject.trim(),
          message: form.message.trim(),
        }),
      });

      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error(
          `The support service returned an invalid response (HTTP ${response.status}). Please try again.`
        );
      }

      if (!response.ok || !result?.success) {
        const errors = result?.errors;
        if (
          errors &&
          typeof errors === "object" &&
          !Array.isArray(errors)
        ) {
          const knownFields = [
            "name",
            "email",
            "category",
            "subject",
            "message",
          ];
          const mappedErrors = Object.fromEntries(
            Object.entries(errors).filter(
              ([field, message]) =>
                knownFields.includes(field) &&
                typeof message === "string"
            )
          );

          if (Object.keys(mappedErrors).length > 0) {
            setFieldErrors(mappedErrors);
            setFeedback({
              type: "error",
              message:
                result.message ||
                "Please check the highlighted fields and try again.",
            });
            return;
          }
        }

        throw new Error(
          result?.message ||
            `We could not submit your request (HTTP ${response.status}). Please try again.`
        );
      }

      setFeedback({
        type: result.notificationSent ? "success" : "warning",
        message: result.message,
        requestId: result.requestId,
      });

      setForm(initialForm);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof TypeError
          ? "Unable to connect to CricketClash support. Check your connection and try again."
          : error.message ||
            "We could not submit your request. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="support-page">
      <div className="support-container">
        <nav className="support-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
          <span>Contact &amp; Support</span>
        </nav>

        <header className="support-hero">
          <span className="support-eyebrow">CRICKETCLASH HELP CENTRE</span>
          <h1>How can we help you?</h1>
          <p>
            Have a question or run into a problem? Browse the FAQs or send our
            support team a message using the form below.
          </p>
        </header>

        <div className="support-layout">
          <section className="support-form-card" aria-labelledby="support-form-title">
            <div className="support-card-heading">
              <span className="support-icon" aria-hidden="true">
                ✉
              </span>
              <div>
                <h2 id="support-form-title">Contact our team</h2>
                <p>Tell us how we can help.</p>
              </div>
            </div>

            {feedback && (
              <div
                className={`support-feedback support-feedback--${feedback.type}`}
                role="status"
                aria-live="polite"
              >
                <p>{feedback.message}</p>
                {feedback.requestId && (
                  <small>Reference: {feedback.requestId}</small>
                )}
              </div>
            )}

            <form onSubmit={handleSubmit} className="support-form">
              <div className="support-field">
                <label htmlFor="support-name">Your name</label>
                <input
                  id="support-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  maxLength={80}
                  value={form.name}
                  onChange={handleChange}
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={fieldErrors.name ? "support-name-error" : undefined}
                  placeholder="Enter your name"
                  required
                />
                {fieldErrors.name && (
                  <small id="support-name-error" className="support-field-error">
                    {fieldErrors.name}
                  </small>
                )}
              </div>

              <div className="support-field">
                <label htmlFor="support-email">Email address</label>
                <input
                  id="support-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={form.email}
                  onChange={handleChange}
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={
                    fieldErrors.email
                      ? "support-email-hint support-email-error"
                      : "support-email-hint"
                  }
                  placeholder="you@example.com"
                  required
                />
                <small id="support-email-hint">
                  We'll use this address if we need to reply.
                </small>
                {fieldErrors.email && (
                  <small id="support-email-error" className="support-field-error">
                    {fieldErrors.email}
                  </small>
                )}
              </div>

              <div className="support-field">
                <label htmlFor="support-category">What do you need help with?</label>
                <select
                  id="support-category"
                  name="category"
                  value={form.category}
                  onChange={handleChange}
                  aria-invalid={Boolean(fieldErrors.category)}
                  aria-describedby={
                    fieldErrors.category ? "support-category-error" : undefined
                  }
                  required
                >
                  <option value="account">Account &amp; Registration</option>
                  <option value="email-verification">Email Verification / OTP</option>
                  <option value="login">Login Issues</option>
                  <option value="contest">Matches &amp; Contests</option>
                  <option value="privacy">Privacy &amp; Security</option>
                  <option value="technical">Technical Problem</option>
                  <option value="other">Other</option>
                </select>
                {fieldErrors.category && (
                  <small id="support-category-error" className="support-field-error">
                    {fieldErrors.category}
                  </small>
                )}
              </div>

              <div className="support-field">
                <label htmlFor="support-subject">Subject</label>
                <input
                  id="support-subject"
                  name="subject"
                  type="text"
                  maxLength={120}
                  value={form.subject}
                  onChange={handleChange}
                  aria-invalid={Boolean(fieldErrors.subject)}
                  aria-describedby={
                    fieldErrors.subject ? "support-subject-error" : undefined
                  }
                  placeholder="Briefly describe the issue"
                  required
                />
                {fieldErrors.subject && (
                  <small id="support-subject-error" className="support-field-error">
                    {fieldErrors.subject}
                  </small>
                )}
              </div>

              <div className="support-field">
                <label htmlFor="support-message">Message</label>
                <textarea
                  id="support-message"
                  name="message"
                  rows={6}
                  minLength={10}
                  maxLength={3000}
                  value={form.message}
                  onChange={handleChange}
                  aria-invalid={Boolean(fieldErrors.message)}
                  aria-describedby={
                    fieldErrors.message
                      ? "support-message-length support-message-error"
                      : "support-message-length"
                  }
                  placeholder="Explain what happened and how we can help..."
                  required
                />
                <small id="support-message-length">
                  {form.message.length}/3000 characters
                </small>
                {fieldErrors.message && (
                  <small id="support-message-error" className="support-field-error">
                    {fieldErrors.message}
                  </small>
                )}
              </div>

              {/* Honeypot: keep this field visually hidden from real users. */}
              <div className="support-honeypot" aria-hidden="true">
                <label htmlFor="support-website">Leave this field empty</label>
                <input
                  id="support-website"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website}
                  onChange={handleChange}
                />
              </div>

              <p className="support-privacy-note">
                Please don't include your password, OTP, or payment credentials
                in your message. Read our{" "}
                <Link to="/privacy">Privacy Policy</Link>.
              </p>

              <button
                type="submit"
                className="support-submit"
                disabled={submitting}
              >
                {submitting ? "Submitting..." : "Submit support request"}
                {!submitting && <span aria-hidden="true"> →</span>}
              </button>
            </form>
          </section>

          <aside className="support-sidebar">
            <section className="support-info-card">
              <span className="support-side-icon" aria-hidden="true">
                🏏
              </span>
              <h2>CricketClash Support</h2>
              <p>
                We can help with account access, email verification, technical
                issues, and questions about the platform.
              </p>
              <p className="support-response-note">
                Your request is saved in our support system. Response times may
                vary.
              </p>
            </section>

            <section className="support-info-card support-security-card">
              <span className="support-side-icon" aria-hidden="true">
                🔒
              </span>
              <h2>Keep your account safe</h2>
              <p>
                Our team will never need your password or one-time verification
                code to investigate a support request.
              </p>
            </section>
          </aside>
        </div>

        <section className="support-faq" aria-labelledby="support-faq-title">
          <div className="support-faq-heading">
            <span className="support-eyebrow">QUICK ANSWERS</span>
            <h2 id="support-faq-title">Frequently asked questions</h2>
            <p>Find an answer before sending your request.</p>
          </div>

          <div className="support-faq-list">
            {faqs.map((faq) => (
              <details className="support-faq-item" key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <div className="support-back-home">
          <Link to="/">← Back to CricketClash</Link>
        </div>
      </div>
    </main>
  );
}
