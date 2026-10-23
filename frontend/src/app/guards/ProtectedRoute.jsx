
import {
  Navigate,
  Outlet,
  useLocation,
} from "react-router-dom";

import { useAppSession } from "../../context/SessionContext";
import SessionError from "./SessionError";

export default function ProtectedRoute() {
  const { status } = useAppSession();
  const location = useLocation();

  // Wait until the current session status is determined.
  if (status === "checking") {
    return null;
  }

  // Show the existing session error UI if validation fails.
  if (status === "error") {
    return <SessionError />;
  }

  // Redirect unauthenticated users to login.
  if (status === "unauthenticated") {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location }}
      />
    );
  }

  // Render the requested protected route.
  return <Outlet />;
}
