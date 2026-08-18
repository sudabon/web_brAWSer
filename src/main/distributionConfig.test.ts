import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("distribution config", () => {
  it("packages macOS arm64 and x64 with ad-hoc signing and GitHub publish", async () => {
    const yml = await readFile(join(root, "electron-builder.yml"), "utf8");
    expect(yml).toMatch(/appId:\s*com\.sudabon\.web-brawser/);
    expect(yml).toMatch(/productName:\s*WEBbrAWSer/);
    expect(yml).toMatch(/arm64/);
    expect(yml).toMatch(/x64/);
    expect(yml).toMatch(/identity:\s*"-"/);
    expect(yml).toMatch(/provider:\s*github/);
    expect(yml).toMatch(/aws-console/);
    expect(yml).toMatch(/target:\s*dmg/);
    expect(yml).toMatch(/target:\s*zip/);
  });

  it("uses semver in package.json and does not disable auto-update", async () => {
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      version: string;
      productName?: string;
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.productName).toBe("WEBbrAWSer");
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies["electron-updater"]).toBeDefined();
    expect(pkg.scripts["package"]).toBeDefined();
  });
});
