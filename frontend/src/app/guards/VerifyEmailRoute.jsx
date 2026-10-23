import { Navigate } from "react-router-dom";

import { useAppSession } from "../../context/SessionContext";

import VerifyEmailPage from "../../features/auth/pages/VerifyEmailPage";

import RouteLoading from "./RouteLoading";
import SessionError from "./SessionError";

export default function VerifyEmailRoute() {
  const { status } = useAppSession();

  const email =
    sessionStorage.getItem("cc_pending_email") || "";

  const expiresAt = Number(
    sessionStorage.getItem("cc_otp_expires_at")
  );

  const registrationPending =
    sessionStorage.getItem("cc_registration_pending") === "true";

  // Prevent direct access without a pending registration.
  if (!registrationPending || !email || !expiresAt) {
    return <Navigate to="/login" replace />;
  }

  if (status === "checking") {
    return <RouteLoading />;
  }

  if (status === "error") {
    return <SessionError />;
  }

  if (status === "authenticated") {
    return <Navigate to="/dashboard" replace />;
  }

  return <VerifyEmailPage />;
}