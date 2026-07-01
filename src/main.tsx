import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import App from "./App.tsx";
import "./index.css";

// Android hardware back button: go back in history, or exit at the root.
if (Capacitor.isNativePlatform()) {
  CapacitorApp.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack && window.history.length > 1) {
      window.history.back();
    } else {
      CapacitorApp.exitApp();
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
