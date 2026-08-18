import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  DEFAULT_ISSUER,
  SESSION_DURATION_SECONDS,
  buildLoginUrl,
  createOidcGateway,
  createSsoGateway,
  defaultDestination,
  getRoleCredentials,
  getSigninToken,
  listAccountsWithRoles,
  pollForToken,
  registerClient,
  startDeviceAuthorization,
  type AccountWithRoles,
} from "./federation.ts";

type AccountRoleChoice = {
  accountId: string;
  accountName: string;
  roleName: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`エラー: 環境変数 ${name} が未設定です。`);
    console.error(
      "例: SSO_START_URL=https://my-org.awsapps.com/start SSO_REGION=ap-northeast-1 npm run spike",
    );
    process.exit(1);
  }
  return value;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function parseSessionDurationFlag(argv: string[]): number | undefined {
  for (const arg of argv) {
    if (arg === "--session-duration") {
      return SESSION_DURATION_SECONDS;
    }
    if (arg.startsWith("--session-duration=")) {
      const raw = arg.slice("--session-duration=".length);
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        console.error(`エラー: --session-duration の値が不正です: ${raw}`);
        process.exit(1);
      }
      return parsed;
    }
  }
  return undefined;
}

function autoChoices(choices: AccountRoleChoice[]): AccountRoleChoice[] {
  const seen = new Set<string>();
  const selected: AccountRoleChoice[] = [];
  for (const choice of choices) {
    if (seen.has(choice.accountId)) {
      continue;
    }
    seen.add(choice.accountId);
    selected.push(choice);
    if (selected.length === 2) {
      break;
    }
  }
  return selected;
}

function flattenChoices(accounts: AccountWithRoles[]): AccountRoleChoice[] {
  return accounts.flatMap((account) =>
    account.roleNames.map((roleName) => ({
      accountId: account.accountId,
      accountName: account.accountName,
      roleName,
    })),
  );
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function chooseAccountRole(
  choices: AccountRoleChoice[],
): Promise<AccountRoleChoice | undefined> {
  console.log("");
  console.log("アカウント × ロール:");
  choices.forEach((choice, index) => {
    console.log(
      `  [${index}] ${choice.accountId}  ${choice.accountName}  ${choice.roleName}`,
    );
  });
  console.log("  [q] 終了");

  const answer = await prompt("番号を入力してください: ");
  if (answer.toLowerCase() === "q" || answer === "") {
    return undefined;
  }

  const index = Number(answer);
  if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
    console.error("不正な番号です。");
    return chooseAccountRole(choices);
  }

  return choices[index];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const startUrl = requiredEnv("SSO_START_URL");
  const region = requiredEnv("SSO_REGION");
  const sessionDuration = parseSessionDurationFlag(argv);
  const auto = hasFlag(argv, "--auto");
  const destination = defaultDestination(region);

  if (sessionDuration !== undefined) {
    console.log(`SessionDuration=${sessionDuration} を付与して試行します。`);
  }

  const oidc = createOidcGateway(region);
  const sso = createSsoGateway(region);

  console.log("RegisterClient を実行しています...");
  const client = await registerClient(region);

  console.log("StartDeviceAuthorization を実行しています...");
  const deviceAuth = await startDeviceAuthorization(region, client, startUrl);

  console.log("");
  console.log("ブラウザで次の URL を開き、サインイン・MFA・Allow を完了してください:");
  console.log(`VERIFICATION_URL: ${deviceAuth.verificationUriComplete}`);
  console.log(`ユーザーコード: ${deviceAuth.userCode}`);
  console.log("承認を待っています...");

  const token = await pollForToken(
    oidc,
    client,
    deviceAuth.deviceCode,
    deviceAuth.interval,
  );
  console.log("アクセストークンを取得しました。");

  const accounts = await listAccountsWithRoles(token.accessToken, sso);
  if (accounts.length === 0) {
    throw new Error("利用可能なアカウントがありません。");
  }

  console.log("");
  console.table(
    accounts.map((account) => ({
      accountId: account.accountId,
      accountName: account.accountName,
      roleCount: account.roleNames.length,
    })),
  );

  const choices = flattenChoices(accounts);
  if (choices.length === 0) {
    throw new Error("利用可能なロールがありません。");
  }

  const targets = auto ? autoChoices(choices) : [];
  let generated = 0;

  const emitLoginUrl = async (choice: AccountRoleChoice): Promise<void> => {
    const credentials = await getRoleCredentials(
      sso,
      token.accessToken,
      choice.accountId,
      choice.roleName,
    );
    const signinToken = await getSigninToken(credentials, sessionDuration);
    const loginUrl = buildLoginUrl(signinToken, destination, DEFAULT_ISSUER);

    generated += 1;
    console.log("");
    console.log(
      `ログインURL (${choice.accountName} / ${choice.roleName}) — 15分間・実質1回のみ有効。ファイルには書いていません。`,
    );
    console.log(`LOGIN_URL_${generated}: ${loginUrl}`);
    console.log("");
  };

  if (auto) {
    console.log(
      `--auto: アカウント ${targets.length} 件の先頭ロールでログインURLを生成します。`,
    );
    for (const choice of targets) {
      await emitLoginUrl(choice);
    }
  } else {
    for (;;) {
      const choice = await chooseAccountRole(choices);
      if (!choice) {
        break;
      }

      await emitLoginUrl(choice);

      if (generated === 1 && choices.length > 1) {
        console.log(
          "パーティション分離の検証のため、別アカウントでもう1つ生成することを推奨します。",
        );
      }

      const again = await prompt("別のアカウント×ロールでも生成しますか？ (y/n): ");
      if (again.toLowerCase() !== "y") {
        break;
      }
    }
  }

  if (generated === 0) {
    console.log("ログインURLは生成しませんでした。");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`失敗: ${message}`);
  process.exit(1);
});
