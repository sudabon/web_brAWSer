import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HIBERNATE_AFTER_MS,
  PersistenceStore,
  isUnsafeTabUrl,
  sanitizePersistedTab,
  writeJsonAtomic,
  type PersistedTab,
} from "./PersistenceStore.ts";

async function tempStore(): Promise<{ store: PersistenceStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "brawser-persist-"));
  return { store: new PersistenceStore(dir), dir };
}

function tab(overrides: Partial<PersistedTab> = {}): PersistedTab {
  return {
    id: "tab-1",
    accountRoleKey: "111111111111#Admin",
    url: "https://ap-northeast-1.console.aws.amazon.com/s3/home",
    title: "S3",
    hibernated: true,
    lastActiveAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("PersistenceStore", () => {
  it("reads and writes config.json and tabs.json from the same userData directory", async () => {
    const { store, dir } = await tempStore();
    await store.saveConfig({
      accountSettings: {},
      hibernateAfterMs: 45 * 60_000,
      panelCollapsed: true,
      panelWidth: 320,
    });
    await store.saveTabs([tab()]);

    expect(store.configPath).toBe(join(dir, "config.json"));
    expect(store.tabsPath).toBe(join(dir, "tabs.json"));

    const reloaded = new PersistenceStore(dir);
    await reloaded.load();
    expect(reloaded.config().hibernateAfterMs).toBe(45 * 60_000);
    expect(reloaded.config().panelCollapsed).toBe(true);
    expect(reloaded.config().panelWidth).toBe(320);
    expect(reloaded.tabs()).toEqual([tab()]);
  });

  it("persists Tab fields id, accountRoleKey, url, title, hibernated, lastActiveAt", async () => {
    const { store, dir } = await tempStore();
    const saved = tab({
      id: "abc",
      accountRoleKey: "222#ReadOnly",
      url: "https://us-east-1.console.aws.amazon.com/ec2/home",
      title: "EC2",
      hibernated: false,
      lastActiveAt: 42,
      favicon: "data:image/png;base64,aaa",
    });
    await store.saveTabs([saved]);

    const disk = JSON.parse(await readFile(join(dir, "tabs.json"), "utf8")) as {
      tabs: PersistedTab[];
    };
    expect(disk.tabs[0]).toEqual(saved);
  });

  it("persists custom tab titles across reload", async () => {
    const { store, dir } = await tempStore();
    await store.saveTabs([tab({ customTitle: "prod billing" })]);

    const reloaded = new PersistenceStore(dir);
    await reloaded.load();
    expect(reloaded.tabs()[0]?.customTitle).toBe("prod billing");
  });

  it("defaults hibernate delay and panel layout when config omits them", async () => {
    const { store } = await tempStore();
    await store.load();
    expect(store.config().hibernateAfterMs).toBe(DEFAULT_HIBERNATE_AFTER_MS);
    expect(store.config().panelCollapsed).toBe(false);
    expect(store.config().panelWidth).toBe(260);
    expect(store.config().windowWidth).toBe(1280);
    expect(store.config().windowHeight).toBe(800);
  });

  it("strips SigninToken and federation login URLs before writing tabs.json", async () => {
    const { store, dir } = await tempStore();
    await store.saveTabs([
      tab({
        url: "https://signin.aws.amazon.com/federation?Action=login&SigninToken=secret-token",
      }),
    ]);

    const raw = await readFile(join(dir, "tabs.json"), "utf8");
    expect(raw).not.toMatch(/SigninToken/i);
    expect(raw).not.toContain("secret-token");
    const disk = JSON.parse(raw) as { tabs: PersistedTab[] };
    expect(disk.tabs[0]?.url).toBe("");
  });

  it("keeps the previous safe URL when the current URL is a federation login", () => {
    const previous = tab({ url: "https://ap-northeast-1.console.aws.amazon.com/s3/home" });
    const next = sanitizePersistedTab(
      {
        ...previous,
        url: "https://signin.aws.amazon.com/federation?Action=login&SigninToken=tok",
      },
      previous.url,
    );
    expect(next.url).toBe(previous.url);
    expect(isUnsafeTabUrl(next.url)).toBe(false);
  });

  it("writes atomically so a completed file exists and no temp sibling remains", async () => {
    const { store, dir } = await tempStore();
    await store.saveTabs([tab()]);
    const names = await readdir(dir);
    expect(names).toContain("tabs.json");
    expect(names.some((name) => name.endsWith(".tmp"))).toBe(false);
    const parsed = JSON.parse(await readFile(join(dir, "tabs.json"), "utf8")) as {
      tabs: PersistedTab[];
    };
    expect(parsed.tabs).toHaveLength(1);
  });

  it("does not reject when overlapping atomic writes target the same file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "brawser-persist-"));
    const filePath = join(dir, "tabs.json");
    await Promise.all(
      Array.from({ length: 40 }, (_, index) => writeJsonAtomic(filePath, { n: index })),
    );
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as { n: number };
    expect(parsed.n).toBeGreaterThanOrEqual(0);
    expect(parsed.n).toBeLessThan(40);
    const names = await readdir(dir);
    expect(names.some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("keeps the latest in-memory tabs when saveTabs overlaps", async () => {
    const { store, dir } = await tempStore();
    await Promise.all([
      store.saveTabs([tab({ id: "first", title: "first" })]),
      store.saveTabs([tab({ id: "second", title: "second" })]),
      store.saveTabs([tab({ id: "latest", title: "latest" })]),
    ]);
    expect(store.tabs()).toEqual([tab({ id: "latest", title: "latest" })]);
    const disk = JSON.parse(await readFile(join(dir, "tabs.json"), "utf8")) as {
      tabs: PersistedTab[];
    };
    expect(disk.tabs).toEqual([tab({ id: "latest", title: "latest" })]);
  });

  it("preserves existing config.json account settings when updating workspace fields", async () => {
    const { dir } = await tempStore();
    await writeFile(
      join(dir, "config.json"),
      `${JSON.stringify(
        {
          sso: { startUrl: "https://d-example.awsapps.com/start", region: "ap-northeast-1" },
          accountSettings: {
            "111111111111": { color: "#ff0000", tags: ["prod"], defaultRegion: "us-east-1" },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const store = new PersistenceStore(dir);
    await store.load();
    await store.updateWorkspace({ panelCollapsed: true, panelWidth: 300 });

    const disk = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as {
      sso: unknown;
      accountSettings: unknown;
      panelCollapsed: boolean;
      panelWidth: number;
    };
    expect(disk.sso).toEqual({
      startUrl: "https://d-example.awsapps.com/start",
      region: "ap-northeast-1",
    });
    expect(disk.accountSettings).toEqual({
      "111111111111": { color: "#ff0000", tags: ["prod"], defaultRegion: "us-east-1" },
    });
    expect(disk.panelCollapsed).toBe(true);
    expect(disk.panelWidth).toBe(300);
  });

  it("persists last window size into config.json", async () => {
    const { store, dir } = await tempStore();
    await store.load();
    await store.updateWorkspace({ windowWidth: 1600, windowHeight: 900 });

    const reloaded = new PersistenceStore(dir);
    await reloaded.load();
    expect(reloaded.config().windowWidth).toBe(1600);
    expect(reloaded.config().windowHeight).toBe(900);
    const disk = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as {
      windowWidth: number;
      windowHeight: number;
    };
    expect(disk.windowWidth).toBe(1600);
    expect(disk.windowHeight).toBe(900);
  });
});
