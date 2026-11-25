import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/inter";
import "@fontsource/averia-serif-libre/400.css";
import "@fontsource/averia-serif-libre/700.css";
import "./styles/theme.css";
import "./styles/app.css";
import "./styles/norse.css";
import App from "./App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

// Block the webview's own context menu and reload shortcuts outside of dev.
if (!import.meta.env.DEV) {
  window.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest("input, textarea, .selectable, .markdown")) e.preventDefault();
  });
}

async function boot() {
  // Browser preview during development: fake the backend (see src/dev/mockTauri.ts).
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    await import("./dev/mockTauri");
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

boot();
