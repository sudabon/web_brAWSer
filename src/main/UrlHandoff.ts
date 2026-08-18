import { isAllowed } from "./NavigationGuard.ts";

export const CUSTOM_SCHEME = "aws-console";

export type HandoffAccount = {
  accountId: string;
  accountRoleKey: string;
};

export type HandoffDecision =
  | { action: "open"; url: string; accountRoleKey: string }
  | { action: "palette"; url: string }
  | { action: "external"; url: string }
  | { action: "ignore" };

export type UrlHandoffHost = {
  focusWindow: () => void;
  accounts: () => HandoffAccount[];
  openInAccount: (accountRoleKey: string, url: string) => Promise<void>;
  showPalette: () => void;
};

type AppPort = {
  requestSingleInstanceLock: () => boolean;
  quit: () => void;
  setAsDefaultProtocolClient: (
    scheme: string,
    execPath?: string,
    args?: string[],
  ) => boolean;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

export type UrlHandoffOptions = {
  app: AppPort;
  openExternal: (url: string) => Promise<void> | void;
  argv: string[];
  packaged: boolean;
  execPath: string;
  argv1?: string;
};

const ACCOUNT_QUERY_KEYS = ["accountId", "account_id", "account"] as const;
const ACCOUNT_ID = /^\d{12}$/;

export function normalizeHandoffUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (!trimmed.toLowerCase().startsWith(`${CUSTOM_SCHEME}:`)) {
    return null;
  }
  const rest = trimmed.slice(CUSTOM_SCHEME.length + 1);
  if (/^https?:\/\//i.test(rest)) {
    return rest;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === "open") {
      const inner = parsed.searchParams.get("url");
      if (inner && /^https?:\/\//i.test(inner)) {
        return inner;
      }
    }
    if (!parsed.hostname) {
      return null;
    }
    return `https://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function accountIdFromParams(params: URLSearchParams): string | undefined {
  for (const key of ACCOUNT_QUERY_KEYS) {
    const value = params.get(key);
    if (value && ACCOUNT_ID.test(value)) {
      return value;
    }
  }
  return undefined;
}

export function extractAccountId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  const hostMatch = parsed.hostname.match(/^(\d{12})(?:[.-]|$)/);
  if (hostMatch?.[1]) {
    return hostMatch[1];
  }

  const fromQuery = accountIdFromParams(parsed.searchParams);
  if (fromQuery) {
    return fromQuery;
  }

  const hash = parsed.hash;
  const hashQueryAt = hash.indexOf("?");
  if (hashQueryAt >= 0) {
    const fromHash = accountIdFromParams(new URLSearchParams(hash.slice(hashQueryAt + 1)));
    if (fromHash) {
      return fromHash;
    }
  }

  const arnMatch = url.match(/arn:aws:[^:]*:[^:]*:(\d{12}):/);
  if (arnMatch?.[1]) {
    return arnMatch[1];
  }

  const pathMatch = parsed.pathname.match(/\/(?:accounts|directory)\/(\d{12})(?:\/|$)/);
  return pathMatch?.[1];
}

export function decideHandoff(raw: string, accounts: HandoffAccount[]): HandoffDecision {
  const url = normalizeHandoffUrl(raw);
  if (!url) {
    return { action: "ignore" };
  }
  if (!isAllowed(url)) {
    return { action: "external", url };
  }
  const accountId = extractAccountId(url);
  if (!accountId) {
    return { action: "palette", url };
  }
  const matches = accounts.filter((account) => account.accountId === accountId);
  if (matches.length === 1 && matches[0]) {
    return { action: "open", url, accountRoleKey: matches[0].accountRoleKey };
  }
  return { action: "palette", url };
}

export function extractUrlFromArgv(argv: string[]): string | undefined {
  return argv.find((arg) => {
    if (arg.startsWith(`${CUSTOM_SCHEME}:`)) {
      return true;
    }
    if (!/^https?:\/\//i.test(arg)) {
      return false;
    }
    const normalized = normalizeHandoffUrl(arg);
    return normalized !== null && isAllowed(normalized);
  });
}

export class UrlHandoff {
  #queue: string[] = [];
  #ready = false;
  #pendingPaletteUrl: string | undefined;
  #host?: UrlHandoffHost;
  #gotLock = false;

  constructor(private readonly options: UrlHandoffOptions) {}

  acquireInstanceLock(): boolean {
    this.#gotLock = this.options.app.requestSingleInstanceLock();
    if (!this.#gotLock) {
      this.options.app.quit();
    }
    return this.#gotLock;
  }

  registerProtocol(): void {
    const { app, packaged, execPath, argv1 } = this.options;
    if (!packaged && argv1) {
      app.setAsDefaultProtocolClient(CUSTOM_SCHEME, execPath, [argv1]);
      return;
    }
    app.setAsDefaultProtocolClient(CUSTOM_SCHEME);
  }

  listen(): void {
    this.options.app.on("open-url", (...args: unknown[]) => {
      const event = args[0] as { preventDefault?: () => void };
      const url = String(args[1] ?? "");
      event.preventDefault?.();
      void this.handleRaw(url);
    });
    this.options.app.on("second-instance", (...args: unknown[]) => {
      this.#host?.focusWindow();
      const argv = (args[1] as string[] | undefined) ?? [];
      const url = extractUrlFromArgv(argv);
      if (url) {
        void this.handleRaw(url);
      }
    });
    const fromArgv = extractUrlFromArgv(this.options.argv);
    if (fromArgv) {
      void this.handleRaw(fromArgv);
    }
  }

  async attach(host: UrlHandoffHost): Promise<void> {
    this.#host = host;
    this.#ready = true;
    const pending = this.#queue.splice(0);
    for (const raw of pending) {
      await this.handleRaw(raw);
    }
  }

  async handleRaw(raw: string): Promise<void> {
    if (!this.#ready || !this.#host) {
      this.#queue.push(raw);
      return;
    }
    const decision = decideHandoff(raw, this.#host.accounts());
    this.#host.focusWindow();
    if (decision.action === "ignore") {
      return;
    }
    if (decision.action === "external") {
      await this.options.openExternal(decision.url);
      return;
    }
    if (decision.action === "palette") {
      this.#pendingPaletteUrl = decision.url;
      this.#host.showPalette();
      return;
    }
    await this.#host.openInAccount(decision.accountRoleKey, decision.url);
  }

  takePending(): string | undefined {
    const pending = this.#pendingPaletteUrl;
    this.#pendingPaletteUrl = undefined;
    return pending;
  }

  cancelPending(): void {
    this.#pendingPaletteUrl = undefined;
  }
}
