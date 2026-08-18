import type {
  ConsoleSessionView,
  DirectorySnapshot,
  SsoSessionView,
} from "../shared/types.ts";
import { parseAccountRoleKey } from "./accountRole.ts";
import {
  DEFAULT_ISSUER,
  FEDERATION_ENDPOINT,
  defaultDestination,
  federateToConsole,
  getRoleCredentials,
  type SsoGateway,
} from "./FederationService.ts";
import { partitionFromAccountRoleKey } from "./partition.ts";

export const MAX_SILENT_REFEDERATION_ATTEMPTS = 3;

export type ConsoleSession = {
  accountRoleKey: string;
  expiration?: number;
  connectedAt: number;
};

export type TabRecordView = {
  id: string;
  accountRoleKey: string;
  url: string;
};

export type TabHost = {
  openTab(accountRoleKey: string, url: string): string;
  focusAccount(accountRoleKey: string): void;
  tabsFor(accountRoleKey: string): TabRecordView[];
  navigateTab(id: string, url: string): void;
};

export type SessionManagerOptions = {
  ssoGateway: SsoGateway;
  getAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  tabs: TabHost;
  defaultRegionFor: (accountId: string) => string;
  now?: () => number;
  onChange?: () => void;
  ssoView?: () => SsoSessionView;
  accounts?: () => DirectorySnapshot["accounts"];
  refreshing?: () => boolean;
};

export class SessionManager {
  #sessions = new Map<string, ConsoleSession>();
  #selected: string | null = null;
  #refedAttempts = new Map<string, number>();
  #reauthRequired = false;
  #reauthMessage?: string;

  constructor(private readonly options: SessionManagerOptions) {}

  now(): number {
    return this.options.now?.() ?? Date.now();
  }

  partitionFor(accountRoleKey: string): string {
    return partitionFromAccountRoleKey(accountRoleKey);
  }

  selectedAccountRoleKey(): string | null {
    return this.#selected;
  }

  viewFor(accountRoleKey: string): ConsoleSessionView | undefined {
    const session = this.#sessions.get(accountRoleKey);
    if (!session) {
      return undefined;
    }
    return this.#toView(session);
  }

  seedSession(session: ConsoleSession): void {
    this.#sessions.set(session.accountRoleKey, session);
  }

  snapshot(): DirectorySnapshot {
    const now = this.now();
    return {
      sso: this.options.ssoView?.() ?? {
        status: "signed-out",
        encryptionAvailable: true,
      },
      accounts: this.options.accounts?.() ?? [],
      sessions: [...this.#sessions.values()].map((session) => this.#toView(session, now)),
      selectedAccountRoleKey: this.#selected,
      refreshing: this.options.refreshing?.() ?? false,
      reauthRequired: this.#reauthRequired,
      reauthMessage: this.#reauthMessage,
    };
  }

  async connect(accountRoleKey: string): Promise<void> {
    const { accountId } = parseAccountRoleKey(accountRoleKey);
    await this.openUrl(
      accountRoleKey,
      defaultDestination(this.options.defaultRegionFor(accountId)),
    );
  }

  async openUrl(accountRoleKey: string, url: string): Promise<void> {
    this.#selected = accountRoleKey;
    const existing = this.#sessions.get(accountRoleKey);
    if (existing && this.#isLive(existing)) {
      this.options.tabs.openTab(accountRoleKey, url);
      this.options.tabs.focusAccount(accountRoleKey);
      this.options.onChange?.();
      return;
    }
    await this.#federate(accountRoleKey, { destination: url });
  }

  async select(accountRoleKey: string): Promise<void> {
    await this.connect(accountRoleKey);
  }

  async handleTabInteraction(accountRoleKey: string): Promise<void> {
    this.#selected = accountRoleKey;
    const session = this.#sessions.get(accountRoleKey);
    if (!session || this.#isLive(session)) {
      this.options.onChange?.();
      return;
    }
    const attempts = this.#refedAttempts.get(accountRoleKey) ?? 0;
    if (attempts >= MAX_SILENT_REFEDERATION_ATTEMPTS) {
      this.#reauthRequired = true;
      this.#reauthMessage = "コンソールセッションの再接続に失敗しました。再認証してください。";
      this.options.onChange?.();
      return;
    }
    try {
      await this.#federate(accountRoleKey, { reuseExistingTabs: true });
      this.#refedAttempts.delete(accountRoleKey);
    } catch {
      this.#refedAttempts.set(accountRoleKey, attempts + 1);
      if (attempts + 1 >= MAX_SILENT_REFEDERATION_ATTEMPTS) {
        this.#reauthRequired = true;
        this.#reauthMessage = "コンソールセッションの再接続に失敗しました。再認証してください。";
      }
    }
    this.options.onChange?.();
  }

  #isLive(session: ConsoleSession): boolean {
    if (session.expiration === undefined) {
      return true;
    }
    return session.expiration > this.now();
  }

  async #federate(
    accountRoleKey: string,
    options: { reuseExistingTabs?: boolean; destination?: string } = {},
  ): Promise<void> {
    const { accountId, roleName } = parseAccountRoleKey(accountRoleKey);
    const accessToken = await this.options.getAccessToken();
    const creds = await getRoleCredentials(
      this.options.ssoGateway,
      accessToken,
      accountId,
      roleName,
    );
    const existingTabs = this.options.tabs.tabsFor(accountRoleKey);
    const currentUrl = existingTabs[0]?.url;
    const destination =
      options.destination ??
      (options.reuseExistingTabs &&
      currentUrl &&
      !currentUrl.startsWith(FEDERATION_ENDPOINT)
        ? currentUrl
        : defaultDestination(this.options.defaultRegionFor(accountId)));
    const { loginUrl } = await federateToConsole(
      creds,
      destination,
      DEFAULT_ISSUER,
      undefined,
      this.options.fetchImpl,
    );
    this.#sessions.set(accountRoleKey, {
      accountRoleKey,
      expiration: creds.expiration?.getTime(),
      connectedAt: this.now(),
    });
    if (options.reuseExistingTabs && existingTabs.length > 0) {
      for (const tab of existingTabs) {
        this.options.tabs.navigateTab(tab.id, loginUrl);
      }
    } else {
      this.options.tabs.openTab(accountRoleKey, loginUrl);
    }
    this.options.tabs.focusAccount(accountRoleKey);
    this.options.onChange?.();
  }

  #toView(session: ConsoleSession, now = this.now()): ConsoleSessionView {
    return {
      accountRoleKey: session.accountRoleKey,
      connected: this.#isLive(session),
      expiration: session.expiration,
      connectedAt: session.connectedAt,
      remainingMs:
        session.expiration !== undefined ? Math.max(0, session.expiration - now) : undefined,
    };
  }
}
