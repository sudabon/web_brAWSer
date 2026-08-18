import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SidePanel } from "./SidePanel";
import "./side-panel.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
);
