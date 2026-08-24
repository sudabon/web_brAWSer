import type { AccountTag, AccountRoleView } from "../shared/types.ts";
import { ACCOUNT_COLORS, DEFAULT_ACCOUNT_REGION } from "../shared/types.ts";
import { toAccountRoleKey } from "./accountRole.ts";
import type { AccountWithRoles } from "./FederationService.ts";
import { partitionName } from "./partition.ts";
import {
  DEFAULT_HIBERNATE_AFTER_MS,
  PersistenceStore,
  type WorkspaceConfig,
} from "./PersistenceStore.ts";
import { DEFAULT_PANEL_WIDTH, DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH } from "./layout.ts";

export type AccountSettings = {
  color: string;
  tags: AccountTag[];
  defaultRegion: string;
  pinned: boolean;
};

export type SsoStartConfig = {
  startUrl: string;
  region: string;
};

export type AppConfig = {
  sso?: SsoStartConfig;
  accountSettings: Record<string, AccountSettings>;
  directoryCache?: {
    fetchedAt: number;
    accounts: AccountWithRoles[];
  };
  hibernateAfterMs: number;
  panelCollapsed: boolean;
  panelWidth: number;
  windowWidth: number;
  windowHeight: number;
};

export function assignColor(accountId: string, palette: readonly string[] = ACCOUNT_COLORS): string {
  let hash = 0;
  for (const ch of accountId) {
    hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0;
  }
  return palette[Math.abs(hash) % palette.length]!;
}

function emptyConfig(): AppConfig {
  return {
    accountSettings: {},
    hibernateAfterMs: DEFAULT_HIBERNATE_AFTER_MS,
    panelCollapsed: false,
    panelWidth: DEFAULT_PANEL_WIDTH,
    windowWidth: DEFAULT_WINDOW_WIDTH,
    windowHeight: DEFAULT_WINDOW_HEIGHT,
  };
}

export class ConfigStore {
  #config: AppConfig = emptyConfig();
  readonly path: string;
  readonly persistence: PersistenceStore;

  constructor(userDataDir: string, persistence = new PersistenceStore(userDataDir)) {
    this.persistence = persistence;
    this.path = persistence.configPath;
  }

  async load(): Promise<void> {
    await this.persistence.load();
    const stored = this.persistence.config();
    this.#config = {
      sso: isSsoStartConfig(stored.sso) ? stored.sso : undefined,
      accountSettings: isAccountSettingsMap(stored.accountSettings)
        ? stored.accountSettings
        : {},
      directoryCache: isDirectoryCache(stored.directoryCache)
        ? stored.directoryCache
        : undefined,
      hibernateAfterMs: stored.hibernateAfterMs,
      panelCollapsed: stored.panelCollapsed,
      panelWidth: stored.panelWidth,
      windowWidth: stored.windowWidth,
      windowHeight: stored.windowHeight,
    };
  }

  ssoConfig(): SsoStartConfig | undefined {
    return this.#config.sso;
  }

  cachedAccounts(): AccountWithRoles[] {
    return this.#config.directoryCache?.accounts ?? [];
  }

  /**
   * ListAccounts が返す順序は安定しないので、ここで並びを決め切る。
   * 戻り値は一覧・検索・タブが共有するため、順序を揃える場所はここ 1 箇所でよい。
   */
  mergeAccounts(accounts: AccountWithRoles[]): AccountRoleView[] {
    const views: AccountRoleView[] = [];
    for (const account of [...accounts].sort((a, b) => this.#compareAccounts(a, b))) {
      const settings = this.settingsFor(account.accountId);
      for (const roleName of [...account.roleNames].sort(compareNames)) {
        views.push({
          accountId: account.accountId,
          accountName: account.accountName,
          roleName,
          accountRoleKey: toAccountRoleKey(account.accountId, roleName),
          partition: partitionName(account.accountId, roleName),
          color: settings.color,
          tags: [...settings.tags],
          defaultRegion: settings.defaultRegion,
          pinned: settings.pinned,
        });
      }
    }
    return views;
  }

  #compareAccounts(a: AccountWithRoles, b: AccountWithRoles): number {
    const pinned = Number(this.settingsFor(b.accountId).pinned) -
      Number(this.settingsFor(a.accountId).pinned);
    if (pinned !== 0) {
      return pinned;
    }
    const byName = compareNames(a.accountName, b.accountName);
    // 同名のアカウントでも並びが揺れないよう、id で決着させる。
    return byName !== 0 ? byName : compareNames(a.accountId, b.accountId);
  }

  async setSsoConfig(sso: SsoStartConfig): Promise<void> {
    this.#config.sso = sso;
    await this.#persist();
  }

  async updateAccountSettings(
    accountId: string,
    patch: Partial<AccountSettings>,
  ): Promise<AccountSettings> {
    const current = this.settingsFor(accountId);
    const next: AccountSettings = {
      color: patch.color ?? current.color,
      tags: patch.tags ?? current.tags,
      defaultRegion: patch.defaultRegion ?? current.defaultRegion,
      pinned: patch.pinned ?? current.pinned,
    };
    this.#config.accountSettings[accountId] = next;
    await this.#persist();
    return next;
  }

  async saveDirectoryCache(accounts: AccountWithRoles[], fetchedAt = Date.now()): Promise<void> {
    this.#config.directoryCache = { fetchedAt, accounts };
    await this.ensureDefaults(accounts);
    await this.#persist();
  }

  async ensureDefaults(accounts: AccountWithRoles[]): Promise<void> {
    let changed = false;
    for (const account of accounts) {
      if (!this.#config.accountSettings[account.accountId]) {
        this.#config.accountSettings[account.accountId] = this.settingsFor(account.accountId);
        changed = true;
      }
    }
    if (changed) {
      await this.#persist();
    }
  }

  settingsFor(accountId: string): AccountSettings {
    // pinned を持たない時期に保存された設定が残るので、既定値で補う。
    const stored = this.#config.accountSettings[accountId];
    return {
      color: stored?.color ?? assignColor(accountId),
      tags: stored?.tags ?? [],
      defaultRegion: stored?.defaultRegion ?? DEFAULT_ACCOUNT_REGION,
      pinned: stored?.pinned ?? false,
    };
  }

  workspace(): WorkspaceConfig {
    return {
      hibernateAfterMs: this.#config.hibernateAfterMs,
      panelCollapsed: this.#config.panelCollapsed,
      panelWidth: this.#config.panelWidth,
      windowWidth: this.#config.windowWidth,
      windowHeight: this.#config.windowHeight,
    };
  }

  async updateWorkspace(patch: Partial<WorkspaceConfig>): Promise<WorkspaceConfig> {
    const next = await this.persistence.updateWorkspace(patch);
    this.#config.hibernateAfterMs = next.hibernateAfterMs;
    this.#config.panelCollapsed = next.panelCollapsed;
    this.#config.panelWidth = next.panelWidth;
    this.#config.windowWidth = next.windowWidth;
    this.#config.windowHeight = next.windowHeight;
    return next;
  }

  async #persist(): Promise<void> {
    await this.persistence.saveConfig({
      sso: this.#config.sso,
      accountSettings: this.#config.accountSettings,
      directoryCache: this.#config.directoryCache,
      hibernateAfterMs: this.#config.hibernateAfterMs,
      panelCollapsed: this.#config.panelCollapsed,
      panelWidth: this.#config.panelWidth,
      windowWidth: this.#config.windowWidth,
      windowHeight: this.#config.windowHeight,
    });
  }
}

/** 数字を値として比べるので acct2 が acct10 より前に来る。 */
function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function isSsoStartConfig(value: unknown): value is SsoStartConfig {
  if (!value || typeof value !== "object") {
    return false;
  }
  const sso = value as Record<string, unknown>;
  return typeof sso.startUrl === "string" && typeof sso.region === "string";
}

function isAccountSettingsMap(value: unknown): value is Record<string, AccountSettings> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDirectoryCache(
  value: unknown,
): value is NonNullable<AppConfig["directoryCache"]> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const cache = value as Record<string, unknown>;
  return typeof cache.fetchedAt === "number" && Array.isArray(cache.accounts);
}
