import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  buildLoginUrl,
  DEFAULT_ISSUER,
  FEDERATION_ENDPOINT,
  federateToConsole,
  getSigninToken,
  listAccountsWithRoles,
  pollForToken,
  refreshAccessToken,
  type OidcGateway,
  type RoleCredentials,
  type SsoGateway,
} from "./FederationService.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const credentials: RoleCredentials = {
  accessKeyId: "AKIATEST",
  secretAccessKey: "secret",
  sessionToken: "session",
  expiration: new Date("2026-08-15T12:00:00Z"),
};

describe("FederationService isolation", () => {
  it("does not import electron", async () => {
    const source = await readFile(join(__dirname, "FederationService.ts"), "utf8");
    expect(source).not.toMatch(/from ["']electron["']/);
    expect(source).not.toMatch(/require\(["']electron["']\)/);
  });
});

describe("getSigninToken", () => {
  it("POSTs form-encoded credentials to the federation endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe(FEDERATION_ENDPOINT);
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        "Content-Type": "application/x-www-form-urlencoded",
      });
      const body = String(init?.body);
      expect(body).toContain("Action=getSigninToken");
      expect(body).not.toContain("SessionDuration");
      return new Response(JSON.stringify({ SigninToken: "tok-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const token = await getSigninToken(credentials, undefined, fetchImpl);
    expect(token).toBe("tok-1");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("federateToConsole", () => {
  it("builds a login URL and does not return the SigninToken", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ SigninToken: "one-shot-token" }), {
          status: 200,
        }),
    );

    const result = await federateToConsole(
      credentials,
      "https://ap-northeast-1.console.aws.amazon.com/console/home?region=ap-northeast-1",
      DEFAULT_ISSUER,
      undefined,
      fetchImpl,
    );

    expect(result.loginUrl).toContain(`${FEDERATION_ENDPOINT}?`);
    expect(result.loginUrl).toContain("Action=login");
    expect(result.loginUrl).toContain("SigninToken=one-shot-token");
    expect(result).not.toHaveProperty("signinToken");
    expect(Object.keys(result)).toEqual(["loginUrl"]);
  });
});

describe("buildLoginUrl", () => {
  it("puts Destination and Issuer on the federation login URL", () => {
    const url = buildLoginUrl(
      "tok",
      "https://example.console.aws.amazon.com/home",
      "https://localhost/aws-console-browser",
    );
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(FEDERATION_ENDPOINT);
    expect(parsed.searchParams.get("Action")).toBe("login");
    expect(parsed.searchParams.get("Destination")).toBe(
      "https://example.console.aws.amazon.com/home",
    );
    expect(parsed.searchParams.get("Issuer")).toBe(
      "https://localhost/aws-console-browser",
    );
  });
});

describe("listAccountsWithRoles", () => {
  it("fetches roles in parallel with a concurrency cap", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const gateway: SsoGateway = {
      async listAccounts() {
        return {
          accountList: [
            { accountId: "1", accountName: "one" },
            { accountId: "2", accountName: "two" },
            { accountId: "3", accountName: "three" },
            { accountId: "4", accountName: "four" },
          ],
        };
      },
      async listAccountRoles({ accountId }) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return { roleList: [{ roleName: `Role-${accountId}` }] };
      },
      async getRoleCredentials() {
        throw new Error("not used");
      },
    };

    const accounts = await listAccountsWithRoles("token", gateway, {
      concurrency: 2,
    });

    expect(maxInFlight).toBe(2);
    expect(accounts).toEqual([
      { accountId: "1", accountName: "one", roleNames: ["Role-1"] },
      { accountId: "2", accountName: "two", roleNames: ["Role-2"] },
      { accountId: "3", accountName: "three", roleNames: ["Role-3"] },
      { accountId: "4", accountName: "four", roleNames: ["Role-4"] },
    ]);
  });
});

describe("pollForToken", () => {
  it("retries while authorization is pending then returns the token", async () => {
    let attempts = 0;
    const gateway: OidcGateway = {
      async registerClient() {
        throw new Error("not used");
      },
      async startDeviceAuthorization() {
        throw new Error("not used");
      },
      async createToken() {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error("pending");
          error.name = "AuthorizationPendingException";
          throw error;
        }
        return { accessToken: "access", refreshToken: "refresh", expiresIn: 3600 };
      },
    };

    const sleeps: number[] = [];
    const token = await pollForToken(
      gateway,
      { clientId: "id", clientSecret: "secret" },
      "device",
      5,
      {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );

    expect(token.accessToken).toBe("access");
    expect(token.refreshToken).toBe("refresh");
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([5000, 5000]);
  });
});

describe("refreshAccessToken", () => {
  it("exchanges a refresh token for a new access token", async () => {
    const gateway: OidcGateway = {
      async registerClient() {
        throw new Error("not used");
      },
      async startDeviceAuthorization() {
        throw new Error("not used");
      },
      async createToken(input) {
        expect(input.grantType).toBe("refresh_token");
        expect(input.refreshToken).toBe("old-refresh");
        return { accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 100 };
      },
    };

    const token = await refreshAccessToken(
      gateway,
      { clientId: "id", clientSecret: "secret" },
      "old-refresh",
    );
    expect(token).toEqual({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 100,
    });
  });
});
