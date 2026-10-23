import React from "react";
import ReactDOM from "react-dom/client";

import "./styles/index.css";
import "./styles/app.css";
import "./styles/brand.css";
import "./styles/landing-page.css";
import "./styles/auth.css";
import "./styles/otp.css";
import "./styles/user-dashboard.css";
import "./styles/admin-login.css";
import "./styles/admin-dashboard.css";

import App from "./App";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);