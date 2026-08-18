import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  AccountSettingsUpdate,
  DirectorySnapshot,
  SsoConfigureRequest,
} from "../shared/types.ts";
import { AccountDirectory } from "./AccountDirectory.ts";
import { ConfigStore } from "./ConfigStore.ts";
import {
  createOidcGateway,
  createSsoGateway,
  type OidcGateway,
  type SsoGateway,
} from "./FederationService.ts";
import { SessionManager } from "./SessionManager.ts";
import { SsoManager, type DeviceAuthPresenter, type SafeStoragePort } from "./SsoManager.ts";
import type { TabHost } from "./SessionManager.ts";

export type AppControllerOptions = {
  userDataDir: string;
  ssoEncPath: string;
  safeStorage: SafeStoragePort;
  presenter: DeviceAuthPresenter;
  tabs: TabHost;
  onChange: () => void;
};

function lazyOidc(getRegion: () => string): OidcGateway {
  return {
    registerClient: () => createOidcGateway(getRegion()).registerClient(),
    startDeviceAuthorization: (client, startUrl) =>
      createOidcGateway(getRegion()).startDeviceAuthorization(client, startUrl),
    createToken: (input) => createOidcGateway(getRegion()).createToken(input),
  };
}

function lazySso(getRegion: () => string): SsoGateway {
  return createSsoGateway(getRegion());
}

export class AppController {
  readonly config: ConfigStore;
  readonly sso: SsoManager;
  readonly directory: AccountDirectory;
  readonly sessions: SessionManager;
  #refreshing = false;
  #region = "ap-northeast-1";

  constructor(private readonly options: AppControllerOptions) {
    this.config = new ConfigStore(options.userDataDir);
    const getRegion = () => this.#region;
    this.sso = new SsoManager({
      ssoEncPath: options.ssoEncPath,
      safeStorage: options.safeStorage,
      oidc: lazyOidc(getRegion),
      presenter: options.presenter,
      readFile: async (path) => {
        try {
          return await readFile(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
          }
          throw error;
        }
      },
      writeFile: async (path, data) => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, data);
      },
      onChange: () => this.options.onChange(),
    });
    this.directory = new AccountDirectory(this.config, () => lazySso(getRegion));
    this.sessions = new SessionManager({
      ssoGateway: {
        listAccounts: (input) => lazySso(getRegion).listAccounts(input),
        listAccountRoles: (input) => lazySso(getRegion).listAccountRoles(input),
        getRoleCredentials: (input) => lazySso(getRegion).getRoleCredentials(input),
      },
      getAccessToken: () => this.sso.getAccessToken(),
      tabs: options.tabs,
      defaultRegionFor: (accountId) => this.config.settingsFor(accountId).defaultRegion,
      onChange: () => this.options.onChange(),
      ssoView: () => this.sso.view(),
      accounts: () => this.directory.views(),
      refreshing: () => this.#refreshing,
    });
  }

  snapshot(): DirectorySnapshot {
    return this.sessions.snapshot();
  }

  async start(): Promise<void> {
    await this.config.load();
    const ssoConfig = this.config.ssoConfig();
    if (ssoConfig) {
      this.#region = ssoConfig.region;
      this.sso.setStartConfig(ssoConfig);
    }
    await this.sso.restore();
    const restored = this.sso.view();
    if (restored.region) {
      this.#region = restored.region;
    }
    this.options.onChange();
    const status = this.sso.view().status;
    if (status === "signed-in") {
      void this.refreshDirectory();
      return;
    }
    if (status === "signed-out") {
      void this.startAuth();
    }
  }

  async configureSso(request: SsoConfigureRequest): Promise<void> {
    this.#region = request.region;
    await this.config.setSsoConfig(request);
    this.sso.setStartConfig(request);
    await this.startAuth();
  }

  async startAuth(): Promise<void> {
    await this.sso.getAccessToken();
    await this.refreshDirectory();
  }

  async refreshDirectory(): Promise<void> {
    this.#refreshing = true;
    this.options.onChange();
    try {
      const token = await this.sso.getAccessToken();
      await this.directory.refresh(token);
    } finally {
      this.#refreshing = false;
      this.options.onChange();
    }
  }

  async connect(accountRoleKey: string): Promise<void> {
    await this.sessions.connect(accountRoleKey);
  }

  async select(accountRoleKey: string): Promise<void> {
    await this.sessions.select(accountRoleKey);
  }

  async updateAccount(update: AccountSettingsUpdate): Promise<void> {
    await this.config.updateAccountSettings(update.accountId, {
      color: update.color,
      tags: update.tags,
      defaultRegion: update.defaultRegion,
    });
    this.options.onChange();
  }

  async handleTabInteraction(accountRoleKey: string): Promise<void> {
    await this.sessions.handleTabInteraction(accountRoleKey);
  }
}
