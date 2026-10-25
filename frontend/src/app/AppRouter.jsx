
import {
  Routes,
  Route,
  Navigate,
} from "react-router-dom";

import LandingPage from "../pages/LandingPage";
import InfoPage from "../pages/InfoPage";

import RegisterPage from "../features/auth/pages/RegisterPage";
import LoginPage from "../features/auth/pages/LoginPage";
import ForgotPasswordPage from "../features/auth/pages/ForgotPasswordPage";
import VerifyPasswordResetOtpPage from "../features/auth/pages/VerifyPasswordResetOtpPage";
import ResetPasswordPage from "../features/auth/pages/ResetPasswordPage";

import DashboardLayout from "../components/dashboard/DashboardLayout";
import LobbyPage from "../features/dashboard/lobby/LobbyPage";
import MatchesPage from "../features/dashboard/matches/MatchesPage";
import MyContestsPage from "../features/dashboard/contests/MyContestsPage";
import ContestActivityPage from "../features/dashboard/contests/ContestActivityPage";
import ContestLeaderboardPage from "../features/dashboard/contests/ContestLeaderboardPage";
import ProfilePage from "../features/dashboard/profile/ProfilePage";
import WalletPage from "../features/dashboard/wallet/WalletPage";
import ContactUsPage from "../features/dashboard/contact/ContactUsPage";

import AdminLoginPage from "../features/admin/pages/AdminLoginPage";
import AdminForgotPasswordPage from "../features/admin/pages/AdminForgotPasswordPage";
import AdminResetPasswordPage from "../features/admin/pages/AdminResetPasswordPage";
import AdminDashboard from "../features/admin/pages/AdminDashboard";
import AdminLiveMatchCenterPage from "../features/admin/pages/AdminLiveMatchCenterPage";
import AdminLayout from "../features/admin/layouts/AdminLayout";
import AdminMatchesPage from "../features/admin/pages/AdminMatchesPage";
import AdminContestsPage from "../features/admin/pages/AdminContestsPage";
import AdminProfilePage from "../features/admin/pages/AdminProfilePage";
import AdminWithdrawalsPage from "../features/admin/pages/AdminWithdrawalsPage";
import AdminDepositsPage from "../features/admin/pages/AdminDepositsPage";

import ProtectedRoute from "./guards/ProtectedRoute";
import GuestOnlyRoute from "./guards/GuestOnlyRoute";
import VerifyEmailRoute from "./guards/VerifyEmailRoute";
import AdminRoute from "./guards/AdminRoute";

import ScrollToTop from "./ScrollToTop";
import HashScroll from "../components/HashScroll";
import SupportPage from "../pages/SupportPage";

export default function AppRouter() {
  return (
    <>
      <ScrollToTop />

      <Routes>
        {/* Public landing page */}
        <Route
          path="/"
          element={
            <GuestOnlyRoute>
              <LandingPage />
            </GuestOnlyRoute>
          }
        />

        {/* Player registration */}
        <Route
          path="/register"
          element={
            <GuestOnlyRoute>
              <RegisterPage />
            </GuestOnlyRoute>
          }
        />

        {/* Email verification */}
        <Route
          path="/verify-email"
          element={<VerifyEmailRoute />}
        />

        {/* Player login */}
        <Route
          path="/login"
          element={
            <GuestOnlyRoute>
              <LoginPage />
            </GuestOnlyRoute>
          }
        />

        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/verify-reset-otp" element={<VerifyPasswordResetOtpPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* Public information pages */}
        <Route path="/terms" element={<InfoPage />} />
        <Route path="/privacy" element={<InfoPage />} />
        <Route
          path="/responsible-play"
          element={<InfoPage />}
        />
        <Route path="/help" element={<InfoPage />} />
        <Route path="/support" element={<SupportPage />} />

        {/* Admin login */}
        <Route
          path="/admin/login"
          element={<AdminLoginPage />}
        />
        <Route path="/admin/forgot-password" element={<AdminForgotPasswordPage />} />
        <Route path="/admin/reset-password" element={<AdminResetPasswordPage />} />

        {/* Protected admin area */}
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminLayout />
            </AdminRoute>
          }
        >
          <Route
            index
            element={<Navigate to="dashboard" replace />}
          />

          <Route
            path="dashboard"
            element={<AdminDashboard />}
          />

          <Route path="/admin/live-center" element={<AdminLiveMatchCenterPage adminMode />} />

          <Route
            path="profile"
            element={<AdminProfilePage />}
          />

          <Route
            path="matches"
            element={<AdminMatchesPage />}
          />

          <Route
            path="contests"
            element={<AdminContestsPage />}
          />

          <Route
          path="withdrawals"
          element={<AdminWithdrawalsPage />}
          />

          <Route
          path="deposits"
          element={<AdminDepositsPage />}
          />

        </Route>

        {/* Protected player area */}
        <Route element={<ProtectedRoute />}>
          <Route
            path="/dashboard"
            element={<DashboardLayout />}
          >
            <Route
              index
              element={<LobbyPage />}
            />

            <Route
              path="matches"
              element={<MatchesPage />}
            />

            <Route path="live-center" element={<Navigate to="/dashboard" replace />} />

            <Route
              path="contests"
              element={<MyContestsPage />}
            />

            <Route
              path="contests/activity"
              element={<ContestActivityPage />}
            />

            <Route
              path="contests/leaderboard"
              element={<ContestLeaderboardPage />}
            />

            {/* Wallet must be nested inside DashboardLayout */}
            <Route
              path="wallet"
              element={<WalletPage />}
            />

            <Route
              path="profile"
              element={<ProfilePage />}
            />

            <Route
              path="contact"
              element={<ContactUsPage />}
            />
          </Route>
        </Route>

        {/* Redirect unknown URLs */}
        <Route
          path="*"
          element={<Navigate to="/" replace />}
        />
      </Routes>

      <HashScroll />
    </>
  );
}
