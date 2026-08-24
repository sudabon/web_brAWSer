import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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

  it("orders accounts alphabetically instead of by the order AWS returned them", async () => {
    const { store } = await tempStore();
    const views = store.mergeAccounts([
      { accountId: "333333333333", accountName: "zeta", roleNames: ["Admin"] },
      { accountId: "111111111111", accountName: "alpha", roleNames: ["Admin"] },
      { accountId: "222222222222", accountName: "make.AI-admin", roleNames: ["Admin"] },
    ]);

    expect(views.map((view) => view.accountName)).toEqual(["alpha", "make.AI-admin", "zeta"]);
  });

  it("orders account names with embedded numbers by value, not by digit", async () => {
    const { store } = await tempStore();
    const views = store.mergeAccounts([
      { accountId: "111111111111", accountName: "acct10", roleNames: ["Admin"] },
      { accountId: "222222222222", accountName: "acct2", roleNames: ["Admin"] },
    ]);

    expect(views.map((view) => view.accountName)).toEqual(["acct2", "acct10"]);
  });

  it("separates accounts that share a name by account id", async () => {
    const { store } = await tempStore();
    const views = store.mergeAccounts([
      { accountId: "222222222222", accountName: "same", roleNames: ["Admin"] },
      { accountId: "111111111111", accountName: "same", roleNames: ["Admin"] },
    ]);

    expect(views.map((view) => view.accountId)).toEqual(["111111111111", "222222222222"]);
  });

  it("lifts pinned accounts above the alphabetical run", async () => {
    const { store } = await tempStore();
    await store.updateAccountSettings("222222222222", { pinned: true });
    const views = store.mergeAccounts([
      { accountId: "111111111111", accountName: "alpha", roleNames: ["Admin"] },
      { accountId: "222222222222", accountName: "make.AI-admin", roleNames: ["Admin"] },
      { accountId: "333333333333", accountName: "zeta", roleNames: ["Admin"] },
    ]);

    expect(views.map((view) => view.accountName)).toEqual(["make.AI-admin", "alpha", "zeta"]);
    expect(views[0]?.pinned).toBe(true);
    expect(views[1]?.pinned).toBe(false);
  });

  it("keeps pinned accounts alphabetical among themselves", async () => {
    const { store } = await tempStore();
    await store.updateAccountSettings("333333333333", { pinned: true });
    await store.updateAccountSettings("111111111111", { pinned: true });
    const views = store.mergeAccounts([
      { accountId: "333333333333", accountName: "zeta", roleNames: ["Admin"] },
      { accountId: "222222222222", accountName: "beta", roleNames: ["Admin"] },
      { accountId: "111111111111", accountName: "alpha", roleNames: ["Admin"] },
    ]);

    expect(views.map((view) => view.accountName)).toEqual(["alpha", "zeta", "beta"]);
  });

  it("orders the roles inside an account by name", async () => {
    const { store } = await tempStore();
    const views = store.mergeAccounts([
      { accountId: "111111111111", accountName: "alpha", roleNames: ["ReadOnly", "Admin", "Billing"] },
    ]);

    expect(views.map((view) => view.roleName)).toEqual(["Admin", "Billing", "ReadOnly"]);
  });

  it("treats account settings saved before pinning existed as unpinned", async () => {
    const { dir } = await tempStore();
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({
        accountSettings: {
          "111111111111": { color: "#ff0000", tags: ["prod"], defaultRegion: "us-east-1" },
        },
      }),
    );
    const store = new ConfigStore(dir);
    await store.load();

    expect(store.settingsFor("111111111111").pinned).toBe(false);
    const views = store.mergeAccounts([
      { accountId: "111111111111", accountName: "alpha", roleNames: ["Admin"] },
    ]);
    expect(views[0]?.pinned).toBe(false);
    expect(views[0]?.color).toBe("#ff0000");
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
      pinned: false,
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
