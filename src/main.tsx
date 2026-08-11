import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./theme.css";

// StrictMode is deliberately off: it double-invokes effects in development,
// which would make the app walk every watched folder twice on startup.
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
