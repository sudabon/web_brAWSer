import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { FEDERATION_ENDPOINT } from "./FederationService.ts";
import { DEFAULT_PANEL_WIDTH, DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH } from "./layout.ts";

export const DEFAULT_HIBERNATE_AFTER_MS = 30 * 60_000;

export type PersistedTab = {
  id: string;
  accountRoleKey: string;
  url: string;
  title: string;
  customTitle?: string;
  favicon?: string;
  hibernated: boolean;
  lastActiveAt: number;
};

export type WorkspaceConfig = {
  hibernateAfterMs: number;
  panelCollapsed: boolean;
  panelWidth: number;
  windowWidth: number;
  windowHeight: number;
};

export type StoredConfig = Record<string, unknown> & WorkspaceConfig;

export function isUnsafeTabUrl(url: string): boolean {
  if (!url) {
    return false;
  }
  if (url.includes("SigninToken")) {
    return true;
  }
  return url.startsWith(FEDERATION_ENDPOINT);
}

export function sanitizePersistedTab(tab: PersistedTab, previousSafeUrl?: string): PersistedTab {
  if (!isUnsafeTabUrl(tab.url)) {
    return tab;
  }
  const fallback =
    previousSafeUrl && !isUnsafeTabUrl(previousSafeUrl) ? previousSafeUrl : "";
  return { ...tab, url: fallback };
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function defaultWorkspace(): WorkspaceConfig {
  return {
    hibernateAfterMs: DEFAULT_HIBERNATE_AFTER_MS,
    panelCollapsed: false,
    panelWidth: DEFAULT_PANEL_WIDTH,
    windowWidth: DEFAULT_WINDOW_WIDTH,
    windowHeight: DEFAULT_WINDOW_HEIGHT,
  };
}

function parseWorkspace(raw: Record<string, unknown> | undefined): WorkspaceConfig {
  const defaults = defaultWorkspace();
  return {
    hibernateAfterMs:
      typeof raw?.hibernateAfterMs === "number" && raw.hibernateAfterMs > 0
        ? raw.hibernateAfterMs
        : defaults.hibernateAfterMs,
    panelCollapsed:
      typeof raw?.panelCollapsed === "boolean" ? raw.panelCollapsed : defaults.panelCollapsed,
    panelWidth: typeof raw?.panelWidth === "number" ? raw.panelWidth : defaults.panelWidth,
    windowWidth:
      typeof raw?.windowWidth === "number" && Number.isFinite(raw.windowWidth) && raw.windowWidth > 0
        ? raw.windowWidth
        : defaults.windowWidth,
    windowHeight:
      typeof raw?.windowHeight === "number" && Number.isFinite(raw.windowHeight) && raw.windowHeight > 0
        ? raw.windowHeight
        : defaults.windowHeight,
  };
}

function parseTab(raw: unknown): PersistedTab | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const tab = raw as Record<string, unknown>;
  if (
    typeof tab.id !== "string" ||
    typeof tab.accountRoleKey !== "string" ||
    typeof tab.url !== "string" ||
    typeof tab.title !== "string" ||
    typeof tab.hibernated !== "boolean" ||
    typeof tab.lastActiveAt !== "number"
  ) {
    return undefined;
  }
  return sanitizePersistedTab({
    id: tab.id,
    accountRoleKey: tab.accountRoleKey,
    url: tab.url,
    title: tab.title,
    customTitle: typeof tab.customTitle === "string" && tab.customTitle.trim()
      ? tab.customTitle.trim()
      : undefined,
    favicon: typeof tab.favicon === "string" ? tab.favicon : undefined,
    hibernated: tab.hibernated,
    lastActiveAt: tab.lastActiveAt,
  });
}

export class PersistenceStore {
  readonly configPath: string;
  readonly tabsPath: string;
  #rawConfig: Record<string, unknown> = {};
  #workspace: WorkspaceConfig = defaultWorkspace();
  #tabs: PersistedTab[] = [];
  #writeChain: Promise<void> = Promise.resolve();

  constructor(userDataDir: string) {
    this.configPath = join(userDataDir, "config.json");
    this.tabsPath = join(userDataDir, "tabs.json");
  }

  async load(): Promise<void> {
    this.#rawConfig = (await this.#readJson(this.configPath)) ?? {};
    this.#workspace = parseWorkspace(this.#rawConfig);
    const tabsFile = await this.#readJson(this.tabsPath);
    const rawTabs = Array.isArray(tabsFile?.tabs) ? tabsFile.tabs : [];
    this.#tabs = rawTabs
      .map((item) => parseTab(item))
      .filter((item): item is PersistedTab => item !== undefined);
  }

  config(): StoredConfig {
    return {
      ...this.#rawConfig,
      ...this.#workspace,
    };
  }

  tabs(): PersistedTab[] {
    return this.#tabs.map((tab) => ({ ...tab }));
  }

  async saveConfig(config: Record<string, unknown>): Promise<void> {
    this.#rawConfig = { ...config };
    this.#workspace = parseWorkspace(this.#rawConfig);
    await this.#persistConfig();
  }

  async updateWorkspace(patch: Partial<WorkspaceConfig>): Promise<WorkspaceConfig> {
    this.#workspace = {
      ...this.#workspace,
      ...patch,
    };
    await this.#persistConfig();
    return { ...this.#workspace };
  }

  async saveTabs(tabs: PersistedTab[]): Promise<void> {
    const previousById = new Map(this.#tabs.map((tab) => [tab.id, tab]));
    this.#tabs = tabs.map((tab) =>
      sanitizePersistedTab(tab, previousById.get(tab.id)?.url),
    );
    await this.#enqueueWrite(() => writeJsonAtomic(this.tabsPath, { tabs: this.#tabs }));
  }

  async #persistConfig(): Promise<void> {
    const next = {
      ...this.#rawConfig,
      hibernateAfterMs: this.#workspace.hibernateAfterMs,
      panelCollapsed: this.#workspace.panelCollapsed,
      panelWidth: this.#workspace.panelWidth,
      windowWidth: this.#workspace.windowWidth,
      windowHeight: this.#workspace.windowHeight,
    };
    this.#rawConfig = next;
    await this.#enqueueWrite(() => writeJsonAtomic(this.configPath, next));
  }

  #enqueueWrite(task: () => Promise<void>): Promise<void> {
    const run = this.#writeChain.then(task, task);
    this.#writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #readJson(path: string): Promise<Record<string, unknown> | undefined> {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return undefined;
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }
}
