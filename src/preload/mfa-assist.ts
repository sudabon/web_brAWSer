import { ipcRenderer } from "electron";
import {
  isSsoPortalPartition,
  shouldAssistMfa,
  TOTP_CURRENT_CODE_IPC,
} from "../shared/mfaAssist.ts";

const OVERLAY_ID = "brawser-mfa-assist";

export type MfaAssistOptions = {
  partition: string;
  getLocation?: () => string;
  invokeCurrentCode?: () => Promise<string>;
  root?: ParentNode;
};

export function findMfaInput(root: ParentNode): HTMLInputElement | null {
  const selectors = [
    'input[autocomplete="one-time-code"]',
    'input[name*="otp" i]',
    'input[id*="otp" i]',
    'input[name*="mfa" i]',
    'input[id*="mfa" i]',
    'input[name*="totp" i]',
    'input[id*="totp" i]',
    'input[inputmode="numeric"]',
    'input[type="tel"]',
    'input[type="text"][maxlength="6"]',
    'input[type="text"][maxlength="8"]',
  ];
  for (const selector of selectors) {
    const match = queryFirst(root, selector);
    if (match) {
      return match;
    }
  }
  return null;
}

export function insertTotpCode(input: HTMLInputElement, code: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) {
    setter.call(input, code);
  } else {
    input.value = code;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function startMfaAssist(options: MfaAssistOptions): () => void {
  if (!isSsoPortalPartition(options.partition)) {
    return () => {};
  }

  const getLocation = options.getLocation ?? (() => globalThis.location?.href ?? "");
  const invokeCurrentCode =
    options.invokeCurrentCode ??
    (() => ipcRenderer.invoke(TOTP_CURRENT_CODE_IPC) as Promise<string>);
  const root = options.root;

  let overlay: HTMLButtonElement | null = null;
  let attachedTo: HTMLInputElement | null = null;

  const sync = (): void => {
    const url = getLocation();
    if (!shouldAssistMfa(options.partition, url)) {
      removeOverlay();
      return;
    }
    const searchRoot = root ?? globalThis.document;
    if (!searchRoot) {
      return;
    }
    const input = findMfaInput(searchRoot);
    if (!input) {
      removeOverlay();
      return;
    }
    showOverlay(input);
  };

  function showOverlay(input: HTMLInputElement): void {
    const doc = input.ownerDocument;
    if (!overlay) {
      overlay = doc.createElement("button");
      overlay.id = OVERLAY_ID;
      overlay.type = "button";
      overlay.textContent = "入力する";
      overlay.setAttribute("aria-label", "TOTP コードを入力する");
      Object.assign(overlay.style, {
        position: "fixed",
        zIndex: "2147483646",
        border: "0",
        borderRadius: "6px",
        padding: "6px 10px",
        background: "#232f3e",
        color: "#fff",
        font: "13px/1.2 sans-serif",
        cursor: "pointer",
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
      });
      overlay.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void (async () => {
          if (!attachedTo) {
            return;
          }
          const code = await invokeCurrentCode();
          insertTotpCode(attachedTo, code);
          attachedTo.focus();
        })();
      });
      doc.documentElement.appendChild(overlay);
    }
    attachedTo = input;
    const rect = input.getBoundingClientRect();
    overlay.style.left = `${Math.round(rect.right + 8)}px`;
    overlay.style.top = `${Math.round(rect.top)}px`;
    overlay.style.display = "block";
  }

  function removeOverlay(): void {
    attachedTo = null;
    overlay?.remove();
    overlay = null;
  }

  const observer = new MutationObserver(() => sync());
  const doc = (root instanceof Document ? root : globalThis.document) ?? null;
  if (doc?.documentElement) {
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  }
  const timer = globalThis.setInterval(sync, 800);
  if (doc?.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", sync, { once: true });
  } else {
    sync();
  }

  return () => {
    observer.disconnect();
    globalThis.clearInterval(timer);
    removeOverlay();
  };
}

function queryFirst(root: ParentNode, selector: string): HTMLInputElement | null {
  try {
    const match = root.querySelector(selector);
    if (match instanceof HTMLInputElement && isVisibleInput(match)) {
      return match;
    }
  } catch {
    return null;
  }
  return null;
}

function isVisibleInput(input: HTMLInputElement): boolean {
  if (input.disabled || input.readOnly || input.type === "hidden") {
    return false;
  }
  const rect = input.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
