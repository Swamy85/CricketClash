
import { BrowserRouter } from "react-router-dom";

import { SessionProvider } from "./context/SessionContext";
import AppRouter from "./app/AppRouter";
import AdminSessionBoundary from "./app/guards/AdminSessionBoundary";

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <AdminSessionBoundary />
        <AppRouter />
      </SessionProvider>
    </BrowserRouter>
  );
}
