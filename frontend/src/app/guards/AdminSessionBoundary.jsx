
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import {
  getAdminSession,
  clearAdminSession,
} from "../../features/admin/services/adminSession";

const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function AdminSessionBoundary() {
  const location = useLocation();
  const previousPathRef = useRef(location.pathname);

  useEffect(() => {
    const previousPath = previousPathRef.current;
    const currentPath = location.pathname;

    previousPathRef.current = currentPath;

    const wasInAdminArea = previousPath.startsWith("/admin/");
    const isInAdminArea = currentPath.startsWith("/admin/");

    // Moving between admin pages should not log the admin out.
    if (!wasInAdminArea || isInAdminArea) {
      return;
    }

    const sessionId = getAdminSession();

    console.log(
      "[ADMIN SESSION] Leaving admin area:",
      previousPath,
      "->",
      currentPath
    );

    // Clear locally immediately so browser history cannot reuse it.
    clearAdminSession();

    if (!sessionId) {
      console.log("[ADMIN SESSION] No active session to revoke.");
      return;
    }

    // Revoke the same session on the backend.
    fetch(`${API_URL}/api/auth/logout`, {
      method: "POST",
      headers: {
        "X-CricketClash-Session": sessionId,
      },
      cache: "no-store",
    })
      .then((response) => {
        console.log(
          "[ADMIN SESSION] Backend revocation status:",
          response.status
        );
      })
      .catch((error) => {
        console.error(
          "[ADMIN SESSION] Backend revocation failed:",
          error
        );
      });
  }, [location.pathname]);

  return null;
}
