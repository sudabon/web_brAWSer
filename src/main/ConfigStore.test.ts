import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_COLORS } from "../shared/types.ts";
import { ConfigStore } from "./ConfigStore.ts";

async function tempStore(): Promise<{ store: ConfigStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "brawser-config-"));
  return { store: new ConfigStore(dir), dir };
}

describe("ConfigStore", () => {
  it("applies default region, empty tags, and a palette color to unknown accounts", async () => {
    const { store } = await tempStore();
    const views = store.mergeAccounts([
      { accountId: "111111111111", accountName: "prod-main", roleNames: ["Admin"] },
    ]);

    expect(views).toEqual([
      expect.objectContaining({
        accountId: "111111111111",
        accountName: "prod-main",
        roleName: "Admin",
        accountRoleKey: "111111111111#Admin",
        partition: "persist:acct-111111111111-Admin",
        tags: [],
        defaultRegion: "ap-northeast-1",
      }),
    ]);
    expect(ACCOUNT_COLORS).toContain(views[0]?.color);
  });

  it("persists account settings and SSO start configuration to config.json", async () => {
    const { store, dir } = await tempStore();
    await store.setSsoConfig({
      startUrl: "https://d-example.awsapps.com/start",
      region: "ap-northeast-1",
    });
    await store.updateAccountSettings("111111111111", {
      color: "#ff0000",
      tags: ["prod"],
      defaultRegion: "us-east-1",
    });

    const disk = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as {
      sso: { startUrl: string; region: string };
      accountSettings: Record<string, unknown>;
    };
    expect(disk.sso).toEqual({
      startUrl: "https://d-example.awsapps.com/start",
      region: "ap-northeast-1",
    });
    expect(disk.accountSettings["111111111111"]).toEqual({
      color: "#ff0000",
      tags: ["prod"],
      defaultRegion: "us-east-1",
    });
    expect(JSON.stringify(disk)).not.toMatch(/accessKeyId|secretAccessKey|sessionToken|SigninToken/i);
  });

  it("caches the account directory and reloads it on a new store instance", async () => {
    const { store, dir } = await tempStore();
    await store.saveDirectoryCache([
      { accountId: "1", accountName: "one", roleNames: ["Admin"] },
    ]);

    const reloaded = new ConfigStore(dir);
    await reloaded.load();
    expect(reloaded.cachedAccounts()).toEqual([
      { accountId: "1", accountName: "one", roleNames: ["Admin"] },
    ]);
  });

  it("does not write role credentials into the directory cache", async () => {
    const { store, dir } = await tempStore();
    await store.saveDirectoryCache([
      { accountId: "1", accountName: "one", roleNames: ["Admin"] },
    ]);
    const raw = await readFile(join(dir, "config.json"), "utf8");
    expect(raw).not.toMatch(/AKI|secretAccessKey|sessionToken|SigninToken/);
  });

  it("persists hibernate delay and side panel layout into config.json", async () => {
    const { store, dir } = await tempStore();
    await store.updateWorkspace({
      hibernateAfterMs: 10 * 60_000,
      panelCollapsed: true,
      panelWidth: 400,
      windowWidth: 1600,
      windowHeight: 900,
    });

    const reloaded = new ConfigStore(dir);
    await reloaded.load();
    expect(reloaded.workspace()).toEqual({
      hibernateAfterMs: 10 * 60_000,
      panelCollapsed: true,
      panelWidth: 400,
      windowWidth: 1600,
      windowHeight: 900,
    });
    const disk = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as {
      hibernateAfterMs: number;
      panelCollapsed: boolean;
      panelWidth: number;
      windowWidth: number;
      windowHeight: number;
    };
    expect(disk.hibernateAfterMs).toBe(10 * 60_000);
    expect(disk.panelCollapsed).toBe(true);
    expect(disk.panelWidth).toBe(400);
    expect(disk.windowWidth).toBe(1600);
    expect(disk.windowHeight).toBe(900);
  });
});
