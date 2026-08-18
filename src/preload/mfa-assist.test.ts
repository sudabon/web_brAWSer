import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("mfa assist preload contract", () => {
  it("does not auto-submit forms", async () => {
    const source = await readFile(join(root, "src/preload/mfa-assist.ts"), "utf8");
    expect(source).not.toMatch(/\.submit\s*\(/);
    expect(source).not.toMatch(/requestSubmit/);
    expect(source).toMatch(/入力する/);
  });

  it("exposes only the current-code channel from AWS preload", async () => {
    const source = await readFile(join(root, "src/preload/preload-aws.ts"), "utf8");
    expect(source).toMatch(/TOTP_CURRENT_CODE_IPC/);
    expect(source).toMatch(/startAccountColorBar/);
    expect(source).toMatch(/startMfaAssist/);
    expect(source).not.toMatch(/from ["']\.\.\/shared\/types/);
    expect(source).not.toMatch(/totpImport|totpCopy|directoryGet|tabsOpen/);
    expect(source).toMatch(/exposeInMainWorld\("brawserAws", api\)/);
    expect(source).not.toMatch(/exposeInMainWorld\("brawserAws", \{[^}]*color/);
  });
});
