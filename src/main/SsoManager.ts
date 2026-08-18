import type { SsoSessionView } from "../shared/types.ts";
import {
  pollForToken,
  refreshAccessToken,
  type OidcGateway,
  type RegisteredClient,
} from "./FederationService.ts";

export type SsoState = {
  startUrl: string;
  region: string;
  registration: RegisteredClient;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
};

export type SafeStoragePort = {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
};

export type DeviceAuthPresenter = {
  present(verificationUriComplete: string): Promise<void>;
  dismiss(): Promise<void>;
};

export type SsoManagerOptions = {
  ssoEncPath: string;
  safeStorage: SafeStoragePort;
  oidc: OidcGateway;
  presenter: DeviceAuthPresenter;
  now?: () => number;
  readFile: (path: string) => Promise<Buffer | null>;
  writeFile: (path: string, data: Buffer) => Promise<void>;
  onChange?: () => void;
};

const ACCESS_TOKEN_SKEW_MS = 60_000;

export class SsoManager {
  #state: SsoState | undefined;
  #startUrl?: string;
  #region?: string;
  #error?: string;
  #authorizing = false;

  constructor(private readonly options: SsoManagerOptions) {}

  now(): number {
    return this.options.now?.() ?? Date.now();
  }

  setStartConfig(config: { startUrl: string; region: string }): void {
    this.#startUrl = config.startUrl;
    this.#region = config.region;
    if (this.#state) {
      this.#state = { ...this.#state, startUrl: config.startUrl, region: config.region };
    }
    this.options.onChange?.();
  }

  async restore(): Promise<void> {
    const blob = await this.options.readFile(this.options.ssoEncPath);
    if (!blob) {
      return;
    }
    if (!this.options.safeStorage.isEncryptionAvailable()) {
      return;
    }
    try {
      const plain = this.options.safeStorage.decryptString(blob);
      const parsed = JSON.parse(plain) as SsoState;
      this.#state = parsed;
      this.#startUrl = parsed.startUrl;
      this.#region = parsed.region;
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
    }
    this.options.onChange?.();
  }

  async replaceState(state: SsoState): Promise<void> {
    this.#state = state;
    this.#startUrl = state.startUrl;
    this.#region = state.region;
    await this.#persist();
    this.options.onChange?.();
  }

  view(): SsoSessionView {
    const expiresAt = this.#state?.expiresAt;
    const remainingMs =
      expiresAt !== undefined ? Math.max(0, expiresAt - this.now()) : undefined;
    const encryptionAvailable = this.options.safeStorage.isEncryptionAvailable();
    if (this.#error) {
      return {
        status: "error",
        startUrl: this.#startUrl,
        region: this.#region,
        expiresAt,
        remainingMs,
        errorMessage: this.#error,
        encryptionAvailable,
      };
    }
    if (this.#authorizing) {
      return {
        status: "authorizing",
        startUrl: this.#startUrl,
        region: this.#region,
        expiresAt,
        remainingMs,
        encryptionAvailable,
      };
    }
    if (this.#hasValidAccessToken()) {
      return {
        status: "signed-in",
        startUrl: this.#startUrl,
        region: this.#region,
        expiresAt,
        remainingMs,
        encryptionAvailable,
      };
    }
    if (!this.#startUrl || !this.#region) {
      return { status: "unconfigured", encryptionAvailable };
    }
    return {
      status: "signed-out",
      startUrl: this.#startUrl,
      region: this.#region,
      expiresAt,
      remainingMs,
      encryptionAvailable,
    };
  }

  async getAccessToken(): Promise<string> {
    this.#error = undefined;
    if (this.#hasValidAccessToken() && this.#state?.accessToken) {
      return this.#state.accessToken;
    }

    await this.#ensureRegistration();

    if (this.#state?.refreshToken) {
      try {
        const token = await refreshAccessToken(
          this.options.oidc,
          this.#state.registration,
          this.#state.refreshToken,
        );
        await this.#applyToken(token.accessToken, token.refreshToken, token.expiresIn);
        return token.accessToken;
      } catch {
        // Fall through to device authorization.
      }
    }

    return this.#deviceAuthorize();
  }

  async #ensureRegistration(): Promise<void> {
    const startUrl = this.#requireStartUrl();
    const region = this.#requireRegion();
    const registration = this.#state?.registration;
    if (registration && !this.#isRegistrationExpired(registration)) {
      return;
    }
    const next = await this.options.oidc.registerClient();
    this.#state = {
      startUrl,
      region,
      registration: next,
      accessToken: undefined,
      refreshToken: undefined,
      expiresAt: undefined,
    };
    await this.#persist();
  }

  async #deviceAuthorize(): Promise<string> {
    const startUrl = this.#requireStartUrl();
    const region = this.#requireRegion();
    await this.#ensureRegistration();
    const registration = this.#state!.registration;
    this.#authorizing = true;
    this.options.onChange?.();
    try {
      const device = await this.options.oidc.startDeviceAuthorization(
        registration,
        startUrl,
      );
      await this.options.presenter.present(device.verificationUriComplete);
      const token = await pollForToken(
        this.options.oidc,
        registration,
        device.deviceCode,
        device.interval,
      );
      await this.#applyToken(token.accessToken, token.refreshToken, token.expiresIn);
      return token.accessToken;
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.#authorizing = false;
      await this.options.presenter.dismiss();
      this.options.onChange?.();
    }
  }

  async #applyToken(
    accessToken: string,
    refreshToken: string | undefined,
    expiresIn: number | undefined,
  ): Promise<void> {
    const startUrl = this.#requireStartUrl();
    const region = this.#requireRegion();
    this.#state = {
      startUrl,
      region,
      registration: this.#state!.registration,
      accessToken,
      refreshToken: refreshToken ?? this.#state?.refreshToken,
      expiresAt:
        expiresIn !== undefined ? this.now() + expiresIn * 1000 : this.#state?.expiresAt,
    };
    await this.#persist();
    this.options.onChange?.();
  }

  async #persist(): Promise<void> {
    if (!this.#state) {
      return;
    }
    if (!this.options.safeStorage.isEncryptionAvailable()) {
      return;
    }
    const payload: SsoState = {
      startUrl: this.#state.startUrl,
      region: this.#state.region,
      registration: this.#state.registration,
      accessToken: this.#state.accessToken,
      refreshToken: this.#state.refreshToken,
      expiresAt: this.#state.expiresAt,
    };
    const encrypted = this.options.safeStorage.encryptString(JSON.stringify(payload));
    await this.options.writeFile(this.options.ssoEncPath, encrypted);
  }

  #hasValidAccessToken(): boolean {
    const token = this.#state?.accessToken;
    const expiresAt = this.#state?.expiresAt;
    if (!token || expiresAt === undefined) {
      return false;
    }
    return expiresAt - ACCESS_TOKEN_SKEW_MS > this.now();
  }

  #isRegistrationExpired(registration: RegisteredClient): boolean {
    if (registration.clientSecretExpiresAt === undefined) {
      return false;
    }
    return registration.clientSecretExpiresAt * 1000 <= this.now();
  }

  #requireStartUrl(): string {
    const startUrl = this.#startUrl ?? this.#state?.startUrl;
    if (!startUrl) {
      throw new Error("SSO start URL が設定されていません");
    }
    return startUrl;
  }

  #requireRegion(): string {
    const region = this.#region ?? this.#state?.region;
    if (!region) {
      throw new Error("SSO region が設定されていません");
    }
    return region;
  }
}
