import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PersistenceStore, type PersistedTab } from "./PersistenceStore.ts";
import { TabManager, type TabViewHandle } from "./TabManager.ts";
import { duplicateAccelerators, SHORTCUTS } from "./ShortcutRegistry.ts";
import { uniqueDownloadPath } from "./DownloadManager.ts";

function fakeView(): TabViewHandle {
  return {
    setBounds: vi.fn(),
    webContents: {
      loadURL: vi.fn(async () => {}),
      close: vi.fn(),
      reload: vi.fn(),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      openDevTools: vi.fn(),
      findInPage: vi.fn(),
      stopFindInPage: vi.fn(),
    },
  };
}

describe("workspace persistence verification", () => {
  it("restores 30 tabs as hibernated without creating webContents", () => {
    const created: TabViewHandle[] = [];
    const manager = new TabManager({
      window: { contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } } as never,
      awsPreloadPath: "/preload.cjs",
      getWindowSize: () => ({ width: 1280, height: 800 }),
      getPanelState: () => ({ collapsed: false, width: 260 }),
      onChange: () => {},
      attachGuard: () => {},
      createView: () => {
        const view = fakeView();
        created.push(view);
        return view;
      },
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    });
    const tabs: PersistedTab[] = Array.from({ length: 30 }, (_, index) => ({
      id: `tab-${index}`,
      accountRoleKey: "111#Admin",
      url: `https://ap-northeast-1.console.aws.amazon.com/s3/home?x=${index}`,
      title: `Tab ${index}`,
      hibernated: false,
      lastActiveAt: index,
    }));
    manager.restorePersisted(tabs);
    expect(manager.snapshots()).toHaveLength(30);
    expect(manager.snapshots().every((tab) => tab.hibernated)).toBe(true);
    expect(created).toHaveLength(0);
  });

  it("does not persist SigninToken URLs into tabs.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "brawser-verify-"));
    const store = new PersistenceStore(dir);
    await store.saveTabs([
      {
        id: "1",
        accountRoleKey: "111#Admin",
        url: "https://signin.aws.amazon.com/federation?Action=login&SigninToken=super-secret",
        title: "Login",
        hibernated: true,
        lastActiveAt: 1,
      },
    ]);
    const raw = await readFile(join(dir, "tabs.json"), "utf8");
    expect(raw).not.toMatch(/SigninToken/i);
    expect(raw).not.toContain("super-secret");
  });

  it("assigns unique download names so credentials.csv is not overwritten", async () => {
    const path = await uniqueDownloadPath("/tmp/AWS/prod-web", "credentials.csv", (candidate) =>
      candidate.endsWith("credentials.csv"),
    );
    expect(path).toBe("/tmp/AWS/prod-web/credentials (1).csv");
  });

  it("keeps shortcut accelerators unique including Cmd+B", () => {
    expect(duplicateAccelerators(SHORTCUTS)).toEqual([]);
    expect(SHORTCUTS.some((item) => item.accelerator === "CommandOrControl+B")).toBe(true);
  });
});
