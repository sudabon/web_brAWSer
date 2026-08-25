import { WebContentsView, type BaseWindow, type WebContents } from "electron";
import { attachNavigationGuard } from "./navigationHandlers.ts";
import {
  contentViewBounds,
  type PanelLayoutState,
  type ViewBounds,
} from "./layout.ts";
import { BROWSER_PARTITION_ARG_PREFIX } from "../shared/mfaAssist.ts";
import {
  ACCOUNT_COLOR_IPC,
  BROWSER_ACCOUNT_COLOR_ARG_PREFIX,
} from "../shared/accountColor.ts";
import { parseAccountRoleKey } from "./accountRole.ts";
import { partitionFromAccountRoleKey } from "./partition.ts";
import { FEDERATION_ENDPOINT } from "./FederationService.ts";
import { consoleServiceLabel } from "../shared/consoleService.ts";
import type { OpenTabRequest, TabSnapshot } from "../shared/types.ts";
import {
  isUnsafeTabUrl,
  type PersistedTab,
} from "./PersistenceStore.ts";
import { DEFAULT_HIBERNATE_AFTER_MS } from "./PersistenceStore.ts";
import {
  DEFAULT_MAX_LIVE_TABS_PER_ACCOUNT,
  tabsToHibernateForAccountLimit,
  tabsToHibernateForInactivity,
} from "./hibernatePolicy.ts";

export type TabViewHandle = {
  setBounds(bounds: ViewBounds): void;
  webContents: {
    loadURL(url: string): Promise<void> | void;
    close(): void;
    reload(): void;
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    setWindowOpenHandler: (handler: (details: { url: string }) => { action: "deny" }) => void;
    openDevTools: (options?: { mode: string }) => void;
    findInPage: (text: string, options?: object) => number;
    stopFindInPage: (action: "clearSelection" | "keepSelection" | "activateSelection") => void;
    send?: (channel: string, ...args: unknown[]) => void;
    session?: { partition?: string };
  };
};

export type TabRecord = {
  id: string;
  accountRoleKey: string;
  url: string;
  title: string;
  customTitle?: string;
  favicon?: string;
  hibernated: boolean;
  lastActiveAt: number;
  view: TabViewHandle | null;
};

type TabManagerOptions = {
  window: BaseWindow;
  awsPreloadPath: string;
  getWindowSize: () => { width: number; height: number };
  getPanelState: () => PanelLayoutState;
  onChange: () => void;
  onInteract?: (accountRoleKey: string) => void;
  createView?: (input: {
    partition: string;
    preload: string;
    accountRoleKey: string;
  }) => TabViewHandle;
  attachGuard?: (contents: WebContents, onAllowedWindowOpen: (url: string) => void) => void;
  now?: () => number;
  hibernateAfterMs?: number;
  maxLiveTabsPerAccount?: number;
  persistTabs?: (tabs: PersistedTab[]) => void | Promise<void>;
  setIntervalFn?: (handler: () => void, delay: number) => unknown;
  clearIntervalFn?: (id: unknown) => void;
  getAccountColor?: (accountRoleKey: string) => string | undefined;
  getAccountName?: (accountRoleKey: string) => string | undefined;
  onViewCreated?: (tab: TabRecord) => void;
};

export class TabManager {
  #tabs: TabRecord[] = [];
  #activeId: string | null = null;
  #hibernateAfterMs: number;
  #maxLiveTabsPerAccount: number;
  #timer?: ReturnType<typeof setInterval>;

  constructor(private readonly options: TabManagerOptions) {
    this.#hibernateAfterMs = options.hibernateAfterMs ?? DEFAULT_HIBERNATE_AFTER_MS;
    this.#maxLiveTabsPerAccount = options.maxLiveTabsPerAccount ?? DEFAULT_MAX_LIVE_TABS_PER_ACCOUNT;
    const startTimer = options.setIntervalFn ?? setInterval;
    this.#timer = startTimer(() => this.hibernateIdleTabs(), 30_000) as ReturnType<typeof setInterval>;
  }

  get activeTab(): TabRecord | undefined {
    return this.#tabs.find((tab) => tab.id === this.#activeId);
  }

  setHibernateAfterMs(ms: number): void {
    if (ms > 0) {
      this.#hibernateAfterMs = ms;
    }
  }

  snapshots(): TabSnapshot[] {
    return this.#tabs.map((tab) => ({
      id: tab.id,
      accountRoleKey: tab.accountRoleKey,
      url: redactFederationUrl(tab.url),
      title: tab.customTitle ?? this.#defaultTitle(tab),
      favicon: tab.favicon,
      hibernated: tab.hibernated,
      active: tab.id === this.#activeId,
    }));
  }

  persisted(): PersistedTab[] {
    return this.#tabs.map((tab) => ({
      id: tab.id,
      accountRoleKey: tab.accountRoleKey,
      url: isUnsafeTabUrl(tab.url) ? "" : tab.url,
      title: tab.title,
      customTitle: tab.customTitle,
      favicon: tab.favicon,
      hibernated: tab.hibernated,
      lastActiveAt: tab.lastActiveAt,
    }));
  }

  restorePersisted(tabs: PersistedTab[]): void {
    this.#tabs = tabs.map((tab) => ({
      ...tab,
      url: isUnsafeTabUrl(tab.url) ? "" : tab.url,
      hibernated: true,
      view: null,
    }));
    this.#activeId = null;
    this.#persist();
    this.options.onChange();
  }

  openTab({ accountRoleKey, url }: OpenTabRequest): string {
    const tab: TabRecord = {
      id: crypto.randomUUID(),
      accountRoleKey,
      url,
      title: "Loading…",
      hibernated: false,
      lastActiveAt: this.#now(),
      view: null,
    };
    this.#tabs.push(tab);
    this.#attachView(tab, url);
    this.selectTab(tab.id);
    this.#enforceAccountLimit(accountRoleKey);
    this.#persist();
    return tab.id;
  }

  renameTab(id: string, title: string): void {
    const tab = this.#tabs.find((item) => item.id === id);
    if (!tab) {
      return;
    }
    const trimmed = title.trim().slice(0, 80);
    tab.customTitle = trimmed || undefined;
    this.#persist();
    this.options.onChange();
  }

  reorderTab(id: string, toIndex: number): void {
    const from = this.#tabs.findIndex((tab) => tab.id === id);
    if (from === -1 || !Number.isFinite(toIndex)) {
      return;
    }
    const clamped = Math.max(0, Math.min(Math.trunc(toIndex), this.#tabs.length - 1));
    if (from === clamped) {
      return;
    }
    const [tab] = this.#tabs.splice(from, 1);
    if (!tab) {
      return;
    }
    this.#tabs.splice(clamped, 0, tab);
    this.#persist();
    this.options.onChange();
  }

  selectTab(id: string, options: { interact?: boolean } = {}): void {
    const next = this.#tabs.find((tab) => tab.id === id);
    if (!next) {
      return;
    }
    if (next.hibernated || !next.view) {
      this.restore(next.id);
    }
    if (!next.view) {
      return;
    }

    if (this.#activeId === next.id) {
      this.layout();
      return;
    }

    const previous = this.activeTab;
    if (previous?.view) {
      this.options.window.contentView.removeChildView(previous.view as never);
    }

    this.#activeId = next.id;
    next.lastActiveAt = this.#now();
    this.options.window.contentView.addChildView(next.view as never, 0);
    this.layout();
    this.#persist();
    this.options.onChange();
    if (options.interact !== false) {
      this.options.onInteract?.(next.accountRoleKey);
    }
  }

  hibernate(tabId: string): void {
    const tab = this.#tabs.find((item) => item.id === tabId);
    if (!tab || tab.hibernated) {
      return;
    }
    if (tab.view) {
      this.options.window.contentView.removeChildView(tab.view as never);
      tab.view.webContents.close();
      tab.view = null;
    }
    tab.hibernated = true;
    if (this.#activeId === tabId) {
      this.#activeId = null;
    }
    this.#persist();
    this.options.onChange();
  }

  restore(tabId: string): void {
    const tab = this.#tabs.find((item) => item.id === tabId);
    if (!tab) {
      return;
    }
    if (!tab.hibernated && tab.view) {
      return;
    }
    const url = tab.url;
    tab.hibernated = false;
    tab.lastActiveAt = this.#now();
    this.#attachView(tab, url);
    this.options.onInteract?.(tab.accountRoleKey);
    this.#persist();
    this.options.onChange();
  }

  hibernateIdleTabs(now = this.#now()): void {
    const ids = tabsToHibernateForInactivity(
      this.#tabs,
      now,
      this.#hibernateAfterMs,
      this.#activeId,
    );
    for (const id of ids) {
      this.hibernate(id);
    }
  }

  closeTab(id: string): void {
    const index = this.#tabs.findIndex((tab) => tab.id === id);
    if (index === -1) {
      return;
    }

    const [tab] = this.#tabs.splice(index, 1);
    if (tab?.view) {
      this.options.window.contentView.removeChildView(tab.view as never);
      tab.view.webContents.close();
      tab.view = null;
    }

    if (this.#activeId === id) {
      this.#activeId = null;
      const fallback = this.#tabs[index] ?? this.#tabs[index - 1];
      if (fallback) {
        this.selectTab(fallback.id);
        this.#persist();
        return;
      }
    }

    this.#persist();
    this.options.onChange();
  }

  layout(): void {
    const bounds = contentViewBounds(
      this.options.getWindowSize(),
      this.options.getPanelState(),
    );
    this.activeTab?.view?.setBounds(bounds);
  }

  tabsFor(accountRoleKey: string): { id: string; accountRoleKey: string; url: string }[] {
    return this.#tabs
      .filter((tab) => tab.accountRoleKey === accountRoleKey)
      .map((tab) => ({
        id: tab.id,
        accountRoleKey: tab.accountRoleKey,
        url: tab.url,
      }));
  }

  tabsForAccount(accountRoleKey: string): TabRecord[] {
    return this.#tabs.filter((tab) => tab.accountRoleKey === accountRoleKey);
  }

  focusAccount(accountRoleKey: string): void {
    const match =
      [...this.#tabs].reverse().find((tab) => tab.accountRoleKey === accountRoleKey) ??
      this.#tabs.find((tab) => tab.accountRoleKey === accountRoleKey);
    if (match) {
      this.selectTab(match.id, { interact: false });
    }
  }

  navigateTab(id: string, url: string): void {
    const tab = this.#tabs.find((item) => item.id === id);
    if (!tab) {
      return;
    }
    if (!isUnsafeTabUrl(url)) {
      tab.url = url;
    }
    if (tab.hibernated || !tab.view) {
      tab.url = isUnsafeTabUrl(url) ? tab.url : url;
      this.restore(id);
      if (tab.view && isUnsafeTabUrl(url)) {
        void tab.view.webContents.loadURL(url);
      }
      this.#persist();
      this.options.onChange();
      return;
    }
    void tab.view.webContents.loadURL(url);
    this.#persist();
    this.options.onChange();
  }

  reloadActive(): void {
    this.activeTab?.view?.webContents.reload();
  }

  findInActive(text: string, options?: { forward?: boolean; findNext?: boolean }): number | undefined {
    return this.activeTab?.view?.webContents.findInPage(text, options);
  }

  stopFindInActive(): void {
    this.activeTab?.view?.webContents.stopFindInPage("clearSelection");
  }

  selectAccountTabByIndex(accountRoleKey: string, index: number): void {
    const tabs = this.tabsForAccount(accountRoleKey);
    const tab = tabs[index];
    if (tab) {
      this.selectTab(tab.id);
    }
  }

  cycleAccountTab(accountRoleKey: string, delta: number): void {
    const tabs = this.tabsForAccount(accountRoleKey);
    if (tabs.length === 0) {
      return;
    }
    const current = tabs.findIndex((tab) => tab.id === this.#activeId);
    const next = tabs[(current + delta + tabs.length) % tabs.length];
    if (next) {
      this.selectTab(next.id);
    }
  }

  applyAccountColor(accountId: string, color: string): void {
    for (const tab of this.#tabs) {
      if (parseAccountRoleKey(tab.accountRoleKey).accountId !== accountId) {
        continue;
      }
      tab.view?.webContents.send?.(ACCOUNT_COLOR_IPC, color);
    }
  }

  applyActiveAccountChrome(setWindowColor: (color: string | undefined) => void): void {
    const key = this.activeTab?.accountRoleKey;
    setWindowColor(key ? this.options.getAccountColor?.(key) : undefined);
  }

  dispose(): void {
    const clear = this.options.clearIntervalFn ?? clearInterval;
    if (this.#timer) {
      clear(this.#timer);
      this.#timer = undefined;
    }
    for (const tab of this.#tabs) {
      if (!tab.view) {
        continue;
      }
      this.options.window.contentView.removeChildView(tab.view as never);
      tab.view.webContents.close();
      tab.view = null;
    }
    this.#tabs = [];
    this.#activeId = null;
  }

  #attachView(tab: TabRecord, loadUrl: string): void {
    const partition = partitionFromAccountRoleKey(tab.accountRoleKey);
    const view = (this.options.createView ?? this.#createElectronView)({
      partition,
      preload: this.options.awsPreloadPath,
      accountRoleKey: tab.accountRoleKey,
    });
    tab.view = view;
    tab.hibernated = false;
    const guard = this.options.attachGuard ?? attachNavigationGuard;
    guard(view.webContents as unknown as WebContents, (openedUrl) => {
      this.openTab({ accountRoleKey: tab.accountRoleKey, url: openedUrl });
    });

    view.webContents.on("page-title-updated", (_event, title) => {
      if (typeof title === "string") {
        tab.title = title;
        this.#persist();
        this.options.onChange();
      }
    });
    view.webContents.on("did-navigate", (_event, navigatedUrl) => {
      if (typeof navigatedUrl === "string") {
        this.#updateUrl(tab, navigatedUrl);
      }
    });
    view.webContents.on("did-navigate-in-page", (_event, navigatedUrl) => {
      if (typeof navigatedUrl === "string") {
        this.#updateUrl(tab, navigatedUrl);
      }
    });
    view.webContents.on("page-favicon-updated", (_event, favicons) => {
      const first = Array.isArray(favicons) ? favicons[0] : undefined;
      if (typeof first === "string") {
        tab.favicon = first;
        this.#persist();
        this.options.onChange();
      }
    });
    view.webContents.on("focus", () => {
      this.options.onInteract?.(tab.accountRoleKey);
    });
    const color = this.options.getAccountColor?.(tab.accountRoleKey);
    if (color) {
      view.webContents.send?.(ACCOUNT_COLOR_IPC, color);
    }
    view.webContents.on("did-finish-load", () => {
      const nextColor = this.options.getAccountColor?.(tab.accountRoleKey);
      if (nextColor) {
        view.webContents.send?.(ACCOUNT_COLOR_IPC, nextColor);
      }
    });
    this.options.onViewCreated?.(tab);
    void view.webContents.loadURL(loadUrl);
  }

  #createElectronView = ({
    partition,
    preload,
    accountRoleKey,
  }: {
    partition: string;
    preload: string;
    accountRoleKey: string;
  }): TabViewHandle => {
    const color = this.options.getAccountColor?.(accountRoleKey);
    return new WebContentsView({
      webPreferences: {
        partition,
        additionalArguments: [
          `${BROWSER_PARTITION_ARG_PREFIX}${partition}`,
          ...(color ? [`${BROWSER_ACCOUNT_COLOR_ARG_PREFIX}${color}`] : []),
        ],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        preload,
      },
    }) as unknown as TabViewHandle;
  };

  #updateUrl(tab: TabRecord, url: string): void {
    if (!isUnsafeTabUrl(url)) {
      tab.url = url;
    }
    this.#persist();
    this.options.onChange();
  }

  #enforceAccountLimit(accountRoleKey: string): void {
    const ids = tabsToHibernateForAccountLimit(
      this.#tabs,
      accountRoleKey,
      this.#maxLiveTabsPerAccount,
      this.#activeId,
    );
    for (const id of ids) {
      this.hibernate(id);
    }
  }

  #persist(): void {
    void Promise.resolve(this.options.persistTabs?.(this.persisted())).catch(() => undefined);
  }

  #now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** 既定のタブ名は「アカウント名／サービス名」。どちらも取れなければページタイトル。 */
  #defaultTitle(tab: TabRecord): string {
    const parts = [
      this.#accountName(tab.accountRoleKey),
      consoleServiceLabel(tab.url),
    ].filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join("／") : tab.title;
  }

  #accountName(accountRoleKey: string): string | undefined {
    const name = this.options.getAccountName?.(accountRoleKey)?.trim();
    return name || undefined;
  }
}

function redactFederationUrl(url: string): string {
  return url.startsWith(FEDERATION_ENDPOINT) ? "https://signin.aws.amazon.com/federation" : url;
}
