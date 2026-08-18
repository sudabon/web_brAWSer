import {
  AuthorizationPendingException,
  CreateTokenCommand,
  RegisterClientCommand,
  SSOOIDCClient,
  StartDeviceAuthorizationCommand,
} from "@aws-sdk/client-sso-oidc";
import {
  GetRoleCredentialsCommand,
  ListAccountRolesCommand,
  ListAccountsCommand,
  SSOClient,
} from "@aws-sdk/client-sso";

const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const REFRESH_TOKEN_GRANT_TYPE = "refresh_token";
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const CLIENT_NAME = "web-brawser";
export const DEFAULT_LIST_ACCOUNT_ROLES_CONCURRENCY = 5;

export const FEDERATION_ENDPOINT = "https://signin.aws.amazon.com/federation";
export const DEFAULT_ISSUER = "https://localhost/aws-console-browser";
export const SESSION_DURATION_SECONDS = 43_200;

export type RegisteredClient = {
  clientId: string;
  clientSecret: string;
  clientSecretExpiresAt?: number;
};

export type DeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
  interval: number;
  expiresIn?: number;
};

export type SsoToken = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
};

export type AccountWithRoles = {
  accountId: string;
  accountName: string;
  roleNames: string[];
};

export type RoleCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration?: Date;
};

export type CreateTokenInput = {
  grantType: string;
  deviceCode?: string;
  refreshToken?: string;
};

export type OidcGateway = {
  registerClient(): Promise<RegisteredClient>;
  startDeviceAuthorization(
    client: RegisteredClient,
    startUrl: string,
  ): Promise<DeviceAuthorization>;
  createToken(input: CreateTokenInput & { client: RegisteredClient }): Promise<SsoToken>;
};

export type SsoGateway = {
  listAccounts(input: {
    accessToken: string;
    nextToken?: string;
  }): Promise<{
    accountList?: { accountId?: string; accountName?: string }[];
    nextToken?: string;
  }>;
  listAccountRoles(input: {
    accessToken: string;
    accountId: string;
    nextToken?: string;
  }): Promise<{
    roleList?: { roleName?: string }[];
    nextToken?: string;
  }>;
  getRoleCredentials(input: {
    accessToken: string;
    accountId: string;
    roleName: string;
  }): Promise<RoleCredentials>;
};

export type PollOptions = {
  sleep?: (ms: number) => Promise<void>;
};

export type ListAccountsOptions = {
  concurrency?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuthorizationPending(error: unknown): boolean {
  if (error instanceof AuthorizationPendingException) {
    return true;
  }
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: string }).name === "AuthorizationPendingException"
  );
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const results: R[] = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export function defaultDestination(region: string): string {
  return `https://${region}.console.aws.amazon.com/console/home?region=${region}`;
}

export function createOidcGateway(region: string): OidcGateway {
  const oidc = new SSOOIDCClient({ region });
  return {
    async registerClient() {
      const output = await oidc.send(
        new RegisterClientCommand({
          clientName: CLIENT_NAME,
          clientType: "public",
          grantTypes: [DEVICE_CODE_GRANT_TYPE, REFRESH_TOKEN_GRANT_TYPE],
          scopes: ["sso:account:access"],
        }),
      );
      if (!output.clientId || !output.clientSecret) {
        throw new Error("RegisterClient が clientId / clientSecret を返しませんでした");
      }
      return {
        clientId: output.clientId,
        clientSecret: output.clientSecret,
        clientSecretExpiresAt: output.clientSecretExpiresAt,
      };
    },
    async startDeviceAuthorization(client, startUrl) {
      const output = await oidc.send(
        new StartDeviceAuthorizationCommand({
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          startUrl,
        }),
      );
      if (!output.deviceCode || !output.userCode || !output.verificationUriComplete) {
        throw new Error(
          "StartDeviceAuthorization が deviceCode / userCode / verificationUriComplete を返しませんでした",
        );
      }
      return {
        deviceCode: output.deviceCode,
        userCode: output.userCode,
        verificationUriComplete: output.verificationUriComplete,
        interval:
          output.interval && output.interval > 0
            ? output.interval
            : DEFAULT_POLL_INTERVAL_SECONDS,
        expiresIn: output.expiresIn,
      };
    },
    async createToken({ client, grantType, deviceCode, refreshToken }) {
      const output = await oidc.send(
        new CreateTokenCommand({
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          grantType,
          deviceCode,
          refreshToken,
        }),
      );
      if (!output.accessToken) {
        throw new Error("CreateToken が accessToken を返しませんでした");
      }
      return {
        accessToken: output.accessToken,
        refreshToken: output.refreshToken,
        expiresIn: output.expiresIn,
      };
    },
  };
}

export function createSsoGateway(region: string): SsoGateway {
  const sso = new SSOClient({ region });
  return {
    async listAccounts(input) {
      const output = await sso.send(new ListAccountsCommand(input));
      return { accountList: output.accountList, nextToken: output.nextToken };
    },
    async listAccountRoles(input) {
      const output = await sso.send(new ListAccountRolesCommand(input));
      return { roleList: output.roleList, nextToken: output.nextToken };
    },
    async getRoleCredentials(input) {
      const output = await sso.send(new GetRoleCredentialsCommand(input));
      const creds = output.roleCredentials;
      if (!creds?.accessKeyId || !creds.secretAccessKey || !creds.sessionToken) {
        throw new Error("GetRoleCredentials が一時認証情報を返しませんでした");
      }
      return {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
        expiration:
          typeof creds.expiration === "number" ? new Date(creds.expiration) : undefined,
      };
    },
  };
}

export async function registerClient(region: string): Promise<RegisteredClient> {
  return createOidcGateway(region).registerClient();
}

export async function startDeviceAuthorization(
  region: string,
  client: RegisteredClient,
  startUrl: string,
): Promise<DeviceAuthorization> {
  return createOidcGateway(region).startDeviceAuthorization(client, startUrl);
}

export async function pollForToken(
  gateway: OidcGateway,
  client: RegisteredClient,
  deviceCode: string,
  interval: number,
  options: PollOptions = {},
): Promise<SsoToken> {
  const waitMs = Math.max(interval, 1) * 1000;
  const wait = options.sleep ?? sleep;

  for (;;) {
    try {
      return await gateway.createToken({
        client,
        grantType: DEVICE_CODE_GRANT_TYPE,
        deviceCode,
      });
    } catch (error) {
      if (isAuthorizationPending(error)) {
        await wait(waitMs);
        continue;
      }
      throw error;
    }
  }
}

export async function refreshAccessToken(
  gateway: OidcGateway,
  client: RegisteredClient,
  refreshToken: string,
): Promise<SsoToken> {
  return gateway.createToken({
    client,
    grantType: REFRESH_TOKEN_GRANT_TYPE,
    refreshToken,
  });
}

export async function listAccountsWithRoles(
  accessToken: string,
  gateway: SsoGateway,
  options: ListAccountsOptions = {},
): Promise<AccountWithRoles[]> {
  const collected: { accountId: string; accountName: string }[] = [];
  let accountsNextToken: string | undefined;

  do {
    const page = await gateway.listAccounts({
      accessToken,
      nextToken: accountsNextToken,
    });
    for (const account of page.accountList ?? []) {
      if (!account.accountId) {
        continue;
      }
      collected.push({
        accountId: account.accountId,
        accountName: account.accountName ?? account.accountId,
      });
    }
    accountsNextToken = page.nextToken;
  } while (accountsNextToken);

  const concurrency = Math.max(
    1,
    options.concurrency ?? DEFAULT_LIST_ACCOUNT_ROLES_CONCURRENCY,
  );

  return mapPool(collected, concurrency, async (account) => {
    const roleNames: string[] = [];
    let rolesNextToken: string | undefined;
    do {
      const rolesPage = await gateway.listAccountRoles({
        accessToken,
        accountId: account.accountId,
        nextToken: rolesNextToken,
      });
      for (const role of rolesPage.roleList ?? []) {
        if (role.roleName) {
          roleNames.push(role.roleName);
        }
      }
      rolesNextToken = rolesPage.nextToken;
    } while (rolesNextToken);

    return {
      accountId: account.accountId,
      accountName: account.accountName,
      roleNames,
    };
  });
}

export async function getRoleCredentials(
  gateway: SsoGateway,
  accessToken: string,
  accountId: string,
  roleName: string,
): Promise<RoleCredentials> {
  return gateway.getRoleCredentials({ accessToken, accountId, roleName });
}

export async function getSigninToken(
  credentials: RoleCredentials,
  sessionDuration?: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams();
  body.set("Action", "getSigninToken");
  body.set(
    "Session",
    JSON.stringify({
      sessionId: credentials.accessKeyId,
      sessionKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    }),
  );
  if (sessionDuration !== undefined) {
    body.set("SessionDuration", String(sessionDuration));
  }

  const response = await fetchImpl(FEDERATION_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`getSigninToken が失敗しました (HTTP ${response.status})`);
  }

  let parsed: { SigninToken?: string };
  try {
    parsed = JSON.parse(text) as { SigninToken?: string };
  } catch {
    throw new Error("getSigninToken の応答が JSON ではありませんでした");
  }

  if (!parsed.SigninToken) {
    throw new Error("getSigninToken が SigninToken を返しませんでした");
  }

  return parsed.SigninToken;
}

export function buildLoginUrl(
  signinToken: string,
  destination: string,
  issuer: string,
): string {
  const url = new URL(FEDERATION_ENDPOINT);
  url.searchParams.set("Action", "login");
  url.searchParams.set("Issuer", issuer);
  url.searchParams.set("Destination", destination);
  url.searchParams.set("SigninToken", signinToken);
  return url.toString();
}

export async function federateToConsole(
  credentials: RoleCredentials,
  destination: string,
  issuer: string = DEFAULT_ISSUER,
  sessionDuration?: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ loginUrl: string }> {
  let signinToken = await getSigninToken(credentials, sessionDuration, fetchImpl);
  try {
    return { loginUrl: buildLoginUrl(signinToken, destination, issuer) };
  } finally {
    signinToken = "";
  }
}
