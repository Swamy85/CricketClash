
import { Navigate } from "react-router-dom";
import { useAppSession } from "../../context/SessionContext";
import SessionError from "./SessionError";

export default function GuestOnlyRoute({ children }) {
  const { status } = useAppSession();

  // Validate the session silently.
  if (status === "checking") {
    return null;
  }

  if (status === "error") {
    return <SessionError />;
  }

  if (status === "authenticated") {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
