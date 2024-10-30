import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthenticationProvider } from "./contexts/authentication";
import reportWebVitals from "./reportWebVitals";
import "./styles/app.css";
import { MarketplaceProvider } from "./contexts/marketplace";

const root = ReactDOM.createRoot(document.getElementById("root"));

root.render(
  <>
    <AuthenticationProvider>
      <MarketplaceProvider>
        <App />
      </MarketplaceProvider>
    </AuthenticationProvider>
  </>,
  // document.getElementById("root")
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
