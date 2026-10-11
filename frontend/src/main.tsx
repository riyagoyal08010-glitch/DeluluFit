import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/App";

// Inter, self-hosted (OFL; no third-party requests), standing in for the reference's
// Roobert, which isn't licensed here (FRONTEND_DECISIONS.md F35). Per-weight files carry
// unicode-range, so browsers fetch only the subsets in use (latin-ext has ₹).
import "@fontsource/inter/300.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
// 700 is used only by the landing page's display type (FRONTEND_DECISIONS.md F36).
import "@fontsource/inter/700.css";
import "@/styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
