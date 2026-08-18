import { describe, expect, it, vi } from "vitest";
import type { DeviceAuthorization, OidcGateway, SsoToken } from "./FederationService.ts";
import { SsoManager, type DeviceAuthPresenter, type SafeStoragePort } from "./SsoManager.ts";

function memorySafeStorage(): SafeStoragePort {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(plain, "utf8"),
    decryptString: (blob) => blob.toString("utf8"),
  };
}

function unavailableSafeStorage(): SafeStoragePort {
  return {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error("encryption unavailable");
    },
    decryptString: () => {
      throw new Error("encryption unavailable");
    },
  };
}

function presenter(): DeviceAuthPresenter & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    async present(url) {
      opened.push(url);
    },
    async dismiss() {},
  };
}

function oidc(overrides: Partial<OidcGateway> = {}): OidcGateway {
  return {
    async registerClient() {
      return {
        clientId: "client",
        clientSecret: "secret",
        clientSecretExpiresAt: 2_000_000_000,
      };
    },
    async startDeviceAuthorization() {
      return {
        deviceCode: "device",
        userCode: "ABCD",
        verificationUriComplete: "https://oidc.example/verify",
        interval: 1,
        expiresIn: 600,
      } satisfies DeviceAuthorization;
    },
    async createToken(input) {
      if (input.grantType === "refresh_token") {
        return { accessToken: "refreshed", refreshToken: "refresh-2", expiresIn: 3600 };
      }
      return { accessToken: "access", refreshToken: "refresh", expiresIn: 3600 } satisfies SsoToken;
    },
    ...overrides,
  };
}

describe("SsoManager", () => {
  it("skips device authorization when a valid access token is restored", async () => {
    const files = new Map<string, Buffer>();
    const portal = presenter();
    const manager = new SsoManager({
      ssoEncPath: "/tmp/sso.enc",
      safeStorage: memorySafeStorage(),
      oidc: oidc(),
      presenter: portal,
      now: () => 1_000_000,
      readFile: async (path) => files.get(path) ?? null,
      writeFile: async (path, data) => {
        files.set(path, data);
      },
    });

    await manager.replaceState({
      startUrl: "https://d-example.awsapps.com/start",
      region: "ap-northeast-1",
      registration: { clientId: "client", clientSecret: "secret" },
      accessToken: "cached-access",
      refreshToken: "cached-refresh",
      expiresAt: 1_000_000 + 8 * 60 * 60 * 1000,
    });

    const token = await manager.getAccessToken();
    expect(token).toBe("cached-access");
    expect(portal.opened).toEqual([]);
    expect(manager.view().status).toBe("signed-in");
    expect(manager.view().remainingMs).toBeGreaterThan(0);
  });

  it("opens verificationUriComplete on persist:sso-portal via the presenter", async () => {
    const portal = presenter();
    const manager = new SsoManager({
      ssoEncPath: "/tmp/sso.enc",
      safeStorage: memorySafeStorage(),
      oidc: oidc(),
      presenter: portal,
      now: () => 1_000_000,
      readFile: async () => null,
      writeFile: async () => {},
    });
    manager.setStartConfig({
      startUrl: "https://d-example.awsapps.com/start",
      region: "ap-northeast-1",
    });

    const token = await manager.getAccessToken();
    expect(token).toBe("access");
    expect(portal.opened).toEqual(["https://oidc.example/verify"]);
  });

  it("tries refreshToken before device authorization when the access token is expired", async () => {
    const portal = presenter();
    const refresh = vi.fn(async () => ({
      accessToken: "refreshed",
      refreshToken: "refresh-2",
      expiresIn: 3600,
    }));
    const manager = new SsoManager({
      ssoEncPath: "/tmp/sso.enc",
      safeStorage: memorySafeStorage(),
      oidc: oidc({ createToken: refresh }),
      presenter: portal,
      now: () => 2_000_000,
      readFile: async () => null,
      writeFile: async () => {},
    });
    await manager.replaceState({
      startUrl: "https://d-example.awsapps.com/start",
      region: "ap-northeast-1",
      registration: { clientId: "client", clientSecret: "secret" },
      accessToken: "old",
      refreshToken: "refresh-1",
      expiresAt: 1_000_000,
    });

    expect(await manager.getAccessToken()).toBe("refreshed");
    expect(portal.opened).toEqual([]);
    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({ grantType: "refresh_token", refreshToken: "refresh-1" }),
    );
  });

  it("re-registers the client when the saved registration is expired", async () => {
    const portal = presenter();
    const registered = vi.fn(async () => ({
      clientId: "new-client",
      clientSecret: "new-secret",
      clientSecretExpiresAt: 3_000_000_000,
    }));
    const manager = new SsoManager({
      ssoEncPath: "/tmp/sso.enc",
      safeStorage: memorySafeStorage(),
      oidc: oidc({ registerClient: registered }),
      presenter: portal,
      now: () => 1_700_000_000_000,
      readFile: async () => null,
      writeFile: async () => {},
    });
    await manager.replaceState({
      startUrl: "https://d-example.awsapps.com/start",
      region: "ap-northeast-1",
      registration: {
        clientId: "old",
        clientSecret: "old-secret",
        clientSecretExpiresAt: 1_000,
      },
      accessToken: "old",
      expiresAt: 1,
    });

    await manager.getAccessToken();
    expect(registered).toHaveBeenCalledOnce();
    expect(portal.opened).toEqual(["https://oidc.example/verify"]);
  });

  it("encrypts SSO state to sso.enc without role credentials", async () => {
    const files = new Map<string, Buffer>();
    const manager = new SsoManager({
      ssoEncPath: "/tmp/sso.enc",
      safeStorage: memorySafeStorage(),
      oidc: oidc(),
      presenter: presenter(),
      now: () => 1_000_000,
      readFile: async (path) => files.get(path) ?? null,
      writeFile: async (path, data) => {
        files.set(path, data);
      },
    });
    manager.setStartConfig({
      startUrl: "https://d-example.awsapps.com/start",
      region: "ap-northeast-1",
    });
    await manager.getAccessToken();

    const saved = files.get("/tmp/sso.enc");
    expect(saved).toBeDefined();
    const parsed = JSON.parse(saved!.toString("utf8")) as Record<string, unknown>;
    expect(parsed.accessToken).toBe("access");
    expect(parsed.refreshToken).toBe("refresh");
    expect(JSON.stringify(parsed)).not.toMatch(/accessKeyId|secretAccessKey|sessionToken/);
  });

  it("keeps tokens in memory only when encryption is unavailable", async () => {
    const writes: string[] = [];
    const manager = new SsoManager({
      ssoEncPath: "/tmp/sso.enc",
      safeStorage: unavailableSafeStorage(),
      oidc: oidc(),
      presenter: presenter(),
      now: () => 1_000_000,
      readFile: async () => null,
      writeFile: async (path) => {
        writes.push(path);
      },
    });
    manager.setStartConfig({
      startUrl: "https://d-example.awsapps.com/start",
      region: "ap-northeast-1",
    });
    await manager.getAccessToken();
    expect(writes).toEqual([]);
    expect(manager.view().encryptionAvailable).toBe(false);
    expect(manager.view().status).toBe("signed-in");
  });
});
