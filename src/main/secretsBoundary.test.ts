import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

async function readSource(relativePath: string): Promise<string> {
  return readFile(join(root, relativePath), "utf8");
}

describe("credential secrecy", () => {
  it("does not export temporary credential fields from renderer-facing types", async () => {
    const source = await readSource("src/shared/types.ts");
    expect(source).not.toMatch(/accessKeyId|secretAccessKey|sessionToken|RoleCredentials|SigninToken/);
  });

  it("does not log SigninToken or role credentials", async () => {
    const files = [
      "src/main/FederationService.ts",
      "src/main/SsoManager.ts",
      "src/main/SessionManager.ts",
      "src/main/AppController.ts",
      "src/main/main.ts",
      "src/main/ConfigStore.ts",
      "src/main/PersistenceStore.ts",
      "src/main/TabManager.ts",
      "src/main/DownloadManager.ts",
      "src/main/TotpStore.ts",
      "src/main/totpParse.ts",
      "src/main/QrCapture.ts",
      "src/main/UrlHandoff.ts",
      "src/main/AutoUpdate.ts",
      "src/main/CredentialStore.ts",
    ];
    for (const file of files) {
      const source = await readSource(file);
      expect(source, file).not.toMatch(/console\.(log|info|debug|error|warn)\([^)]*(SigninToken|secretAccessKey|sessionToken|accessKeyId)/);
    }
  });

  it("does not log stored sign-in passwords", async () => {
    const files = [
      "src/main/CredentialStore.ts",
      "src/main/main.ts",
      "src/preload/signin-assist.ts",
      "src/preload/preload-aws.ts",
    ];
    for (const file of files) {
      const source = await readSource(file);
      expect(source, file).not.toMatch(/console\.(log|info|debug|error|warn)\([^)]*password/i);
    }
  });

  it("keeps passwords out of every renderer-facing snapshot and view type", async () => {
    const source = await readSource("src/shared/types.ts");
    const blocks = source.matchAll(/export type (\w+(?:Snapshot|View)) = \{([^}]*)\}/g);
    const checked: string[] = [];
    for (const [, name, body] of blocks) {
      checked.push(name!);
      expect(body, name).not.toMatch(/password/i);
    }
    expect(checked).toContain("SigninCredentialSnapshot");
  });

  it("does not hand the stored credential to the page's main world", async () => {
    const source = await readSource("src/preload/preload-aws.ts");
    expect(source).toMatch(/startSigninAssist/);
    expect(source).not.toMatch(/CREDENTIAL_FILL_IPC/);
    expect(source).not.toMatch(/password/i);
  });
});
