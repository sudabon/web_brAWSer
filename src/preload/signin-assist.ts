import { ipcRenderer } from "electron";
import {
  CREDENTIAL_FILL_IPC,
  isSsoPortalPartition,
  shouldAssistMfa,
} from "../shared/mfaAssist.ts";

const OVERLAY_ID = "brawser-signin-assist";

const USERNAME_HINT = /user|email|mail|account|login|signin|ユーザー|メール|アカウント|サインイン|ログイン/i;
const ONE_TIME_CODE_HINT = /otp|mfa|totp|code|token|コード|ワンタイム|認証番号/i;

export type SigninCredentialFill = {
  username: string;
  password: string;
};

export type SigninInputs = {
  username: HTMLInputElement | null;
  password: HTMLInputElement | null;
};

export type SigninAssistOptions = {
  partition: string;
  getLocation?: () => string;
  invokeCredential?: () => Promise<SigninCredentialFill>;
  root?: ParentNode;
};

/** サインインフォームの入力欄を役割ごとに見分ける。TOTP 欄は対象にしない。 */
export function findSigninInputs(root: ParentNode): SigninInputs {
  const inputs = usableInputs(root);
  return {
    username: inputs.find((input) => isUsernameInput(input)) ?? null,
    password: inputs.find((input) => input.type === "password") ?? null,
  };
}

/** 現在の画面に出ている欄だけを埋める。送信はユーザーに委ねる。 */
export function fillSigninInputs(inputs: SigninInputs, credential: SigninCredentialFill): void {
  if (inputs.username) {
    setInputValue(inputs.username, credential.username);
  }
  if (inputs.password) {
    setInputValue(inputs.password, credential.password);
  }
  (inputs.password ?? inputs.username)?.focus();
}

export function startSigninAssist(options: SigninAssistOptions): () => void {
  if (!isSsoPortalPartition(options.partition)) {
    return () => {};
  }

  const getLocation = options.getLocation ?? (() => globalThis.location?.href ?? "");
  const invokeCredential =
    options.invokeCredential ??
    (() => ipcRenderer.invoke(CREDENTIAL_FILL_IPC) as Promise<SigninCredentialFill>);
  const root = options.root;

  let overlay: HTMLButtonElement | null = null;
  let attachedTo: SigninInputs | null = null;

  const sync = (): void => {
    if (!shouldAssistMfa(options.partition, getLocation())) {
      removeOverlay();
      return;
    }
    const searchRoot = root ?? globalThis.document;
    if (!searchRoot) {
      return;
    }
    const inputs = findSigninInputs(searchRoot);
    const anchor = inputs.username ?? inputs.password;
    if (!anchor) {
      removeOverlay();
      return;
    }
    attachedTo = inputs;
    showOverlay(anchor);
  };

  function showOverlay(anchor: HTMLInputElement): void {
    const doc = anchor.ownerDocument;
    if (!overlay) {
      overlay = doc.createElement("button");
      overlay.id = OVERLAY_ID;
      overlay.type = "button";
      overlay.textContent = "ID/パスワードを入力する";
      overlay.setAttribute("aria-label", "保存したサインイン情報を入力する");
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
          const inputs = attachedTo;
          if (!inputs) {
            return;
          }
          try {
            fillSigninInputs(inputs, await invokeCredential());
          } catch {
            // 未登録・解錠キャンセルはそのまま手入力に任せる。
          }
        })();
      });
      doc.documentElement.appendChild(overlay);
    }
    const rect = anchor.getBoundingClientRect();
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

function usableInputs(root: ParentNode): HTMLInputElement[] {
  let found: ArrayLike<HTMLInputElement>;
  try {
    found = root.querySelectorAll("input");
  } catch {
    return [];
  }
  return Array.from(found).filter(isUsableInput);
}

function isUsableInput(input: HTMLInputElement): boolean {
  if (!input || typeof input.getBoundingClientRect !== "function") {
    return false;
  }
  if (input.disabled || input.readOnly || input.type === "hidden") {
    return false;
  }
  const rect = input.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isUsernameInput(input: HTMLInputElement): boolean {
  if (input.type === "password" || looksLikeOneTimeCodeInput(input)) {
    return false;
  }
  const hints = `${input.autocomplete ?? ""} ${input.name ?? ""} ${input.id ?? ""} ${accessibleLabel(input)}`;
  if (ONE_TIME_CODE_HINT.test(hints)) {
    return false;
  }
  return input.autocomplete === "username" || input.type === "email" || USERNAME_HINT.test(hints);
}

/**
 * ラベル文言に頼らず、形からワンタイムコード欄を見分ける。
 * 文言が想定外でもここで弾き、パスワードが OTP 欄へ流れるのを防ぐ。
 */
function looksLikeOneTimeCodeInput(input: HTMLInputElement): boolean {
  if (input.autocomplete === "one-time-code" || input.type === "tel") {
    return true;
  }
  const inputMode =
    typeof input.getAttribute === "function" ? (input.getAttribute("inputmode") ?? "") : "";
  if (inputMode.toLowerCase() === "numeric") {
    return true;
  }
  return input.maxLength === 6 || input.maxLength === 8;
}

/**
 * 入力欄に見えている文言を集める。
 * Cloudscape (awsui) 製の Identity Center サインイン画面は id を awsui-input-0 と自動生成し、
 * name を持たず autocomplete も "on" なので、label だけが人間と同じ手がかりになる。
 */
function accessibleLabel(input: HTMLInputElement): string {
  const parts: string[] = [];
  const attribute = (name: string): string =>
    typeof input.getAttribute === "function" ? (input.getAttribute(name) ?? "") : "";
  parts.push(attribute("aria-label"));

  const doc = input.ownerDocument ?? null;
  for (const id of attribute("aria-labelledby").split(/\s+/).filter(Boolean)) {
    parts.push(doc?.getElementById(id)?.textContent ?? "");
  }
  if (input.id && doc) {
    try {
      parts.push(doc.querySelector(`label[for="${escapeSelector(input.id)}"]`)?.textContent ?? "");
    } catch {
      // 選択子として使えない id は手がかりにしない。
    }
  }
  if (typeof input.closest === "function") {
    parts.push(input.closest("label")?.textContent ?? "");
  }
  parts.push(input.placeholder ?? "");
  return parts.join(" ");
}

function escapeSelector(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = nativeValueSetter();
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function nativeValueSetter(): ((this: HTMLInputElement, value: string) => void) | undefined {
  if (typeof HTMLInputElement === "undefined") {
    return undefined;
  }
  return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
}
