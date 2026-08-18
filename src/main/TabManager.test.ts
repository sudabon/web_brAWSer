import { describe, expect, it, vi } from "vitest";
import { TabManager, type TabViewHandle } from "./TabManager.ts";
import type { PersistedTab } from "./PersistenceStore.ts";
import type { PanelLayoutState } from "./layout.ts";

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

function createManager(
  overrides: {
    now?: () => number;
    hibernateAfterMs?: number;
    persist?: (tabs: PersistedTab[]) => void;
    onInteract?: (accountRoleKey: string) => void;
    maxLiveTabsPerAccount?: number;
    getAccountName?: (accountRoleKey: string) => string | undefined;
  } = {},
) {
  const created: TabViewHandle[] = [];
  const window = {
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
  };
  const panel: PanelLayoutState = { collapsed: false, width: 260 };
  const tabs = new TabManager({
    window: window as never,
    awsPreloadPath: "/preload.cjs",
    getWindowSize: () => ({ width: 1280, height: 800 }),
    getPanelState: () => panel,
    onChange: () => {},
    onInteract: overrides.onInteract,
    attachGuard: () => {},
    createView: () => {
      const view = fakeView();
      created.push(view);
      return view;
    },
    now: overrides.now,
    hibernateAfterMs: overrides.hibernateAfterMs,
    maxLiveTabsPerAccount: overrides.maxLiveTabsPerAccount,
    persistTabs: overrides.persist,
    getAccountName: overrides.getAccountName,
    setIntervalFn: () => 0,
    clearIntervalFn: () => {},
  });
  return { tabs, created, window };
}

const saved: PersistedTab = {
  id: "saved-1",
  accountRoleKey: "111#Admin",
  url: "https://ap-northeast-1.console.aws.amazon.com/s3/home",
  title: "S3",
  favicon: "https://example/favicon.ico",
  hibernated: false,
  lastActiveAt: 1,
};

describe("TabManager hibernate lifecycle", () => {
  it("distinguishes hibernated tabs from detached live tabs", () => {
    const { tabs, window } = createManager();
    const id = tabs.openTab({
      accountRoleKey: "111#Admin",
      url: "https://ap-northeast-1.console.aws.amazon.com/s3/home",
    });
    expect(tabs.snapshots()[0]?.hibernated).toBe(false);
    tabs.hibernate(id);
    expect(tabs.snapshots()[0]?.hibernated).toBe(true);
    expect(window.contentView.removeChildView).toHaveBeenCalled();
    expect(tabs.snapshots()).toHaveLength(1);
  });

  it("restore recreates webContents and navigates to the saved URL", () => {
    const { tabs, created } = createManager();
    const id = tabs.openTab({
      accountRoleKey: "111#Admin",
      url: "https://ap-northeast-1.console.aws.amazon.com/s3/home",
    });
    tabs.hibernate(id);
    expect(created).toHaveLength(1);
    tabs.restore(id);
    expect(created).toHaveLength(2);
    expect(created[1]?.webContents.loadURL).toHaveBeenCalledWith(
      "https://ap-northeast-1.console.aws.amazon.com/s3/home",
    );
    expect(tabs.snapshots()[0]?.hibernated).toBe(false);
  });

  it("notifies interact on restore so silent refederation can run", () => {
    const onInteract = vi.fn();
    const { tabs } = createManager({ onInteract });
    const id = tabs.openTab({
      accountRoleKey: "111#Admin",
      url: "https://ap-northeast-1.console.aws.amazon.com/s3/home",
    });
    onInteract.mockClear();
    tabs.hibernate(id);
    tabs.restore(id);
    expect(onInteract).toHaveBeenCalledWith("111#Admin");
  });

  it("restores persisted tabs as hibernated without creating webContents", () => {
    const { tabs, created } = createManager();
    tabs.restorePersisted([saved]);
    expect(created).toHaveLength(0);
    expect(tabs.snapshots()).toEqual([
      expect.objectContaining({
        id: "saved-1",
        title: "S3",
        url: "https://ap-northeast-1.console.aws.amazon.com/s3/home",
        hibernated: true,
        favicon: "https://example/favicon.ico",
      }),
    ]);
  });

  it("selecting a hibernated tab restores it", () => {
    const { tabs, created } = createManager();
    tabs.restorePersisted([saved]);
    tabs.selectTab("saved-1");
    expect(created).toHaveLength(1);
    expect(tabs.snapshots()[0]?.hibernated).toBe(false);
    expect(tabs.snapshots()[0]?.active).toBe(true);
  });

  it("persists tabs on add, close, and navigate without SigninToken URLs", () => {
    const persist = vi.fn();
    const { tabs } = createManager({ persist });
    const id = tabs.openTab({
      accountRoleKey: "111#Admin",
      url: "https://signin.aws.amazon.com/federation?Action=login&SigninToken=tok",
    });
    expect(persist).toHaveBeenCalled();
    const first = persist.mock.calls.at(-1)?.[0] as PersistedTab[];
    expect(JSON.stringify(first)).not.toMatch(/SigninToken/);

    tabs.navigateTab(id, "https://ap-northeast-1.console.aws.amazon.com/s3/home");
    const afterNav = persist.mock.calls.at(-1)?.[0] as PersistedTab[];
    expect(afterNav[0]?.url).toBe("https://ap-northeast-1.console.aws.amazon.com/s3/home");

    tabs.closeTab(id);
    const afterClose = persist.mock.calls.at(-1)?.[0] as PersistedTab[];
    expect(afterClose).toEqual([]);
  });

  it("hibernates idle live tabs after the configured delay", () => {
    let now = 0;
    const { tabs } = createManager({
      now: () => now,
      hibernateAfterMs: 1_000,
    });
    tabs.openTab({
      accountRoleKey: "111#Admin",
      url: "https://ap-northeast-1.console.aws.amazon.com/s3/home",
    });
    const idle = tabs.openTab({
      accountRoleKey: "111#Admin",
      url: "https://ap-northeast-1.console.aws.amazon.com/ec2/home",
    });
    now = 2_000;
    tabs.hibernateIdleTabs();
    const idleSnap = tabs.snapshots().find((tab) => tab.id === idle);
    expect(idleSnap?.hibernated).toBe(false);
    const first = tabs.snapshots()[0];
    expect(first?.hibernated).toBe(true);
  });

  it("hibernates the oldest live tab when an account exceeds the live cap", () => {
    const { tabs } = createManager({ maxLiveTabsPerAccount: 2, now: () => 100 });
    tabs.openTab({ accountRoleKey: "111#Admin", url: "https://console.aws.amazon.com/a" });
    tabs.openTab({ accountRoleKey: "111#Admin", url: "https://console.aws.amazon.com/b" });
    tabs.openTab({ accountRoleKey: "111#Admin", url: "https://console.aws.amazon.com/c" });
    const snaps = tabs.snapshots();
    expect(snaps).toHaveLength(3);
    expect(snaps.filter((tab) => tab.hibernated)).toHaveLength(1);
    expect(snaps[0]?.hibernated).toBe(true);
  });
});

function emitPageTitle(view: TabViewHandle, title: string): void {
  const listener = vi
    .mocked(view.webContents.on)
    .mock.calls.find(([event]) => event === "page-title-updated")?.[1] as
    | ((event: unknown, title: string) => void)
    | undefined;
  listener?.({}, title);
}

describe("TabManager custom titles", () => {
  it("shows the renamed title in the snapshot", () => {
    const { tabs } = createManager();
    const id = tabs.openTab({
      accountRoleKey: "111#Admin",
      url: "https://ap-northeast-1.console.aws.amazon.com/s3/home",
    });
    tabs.renameTab(id, "prod billing");
    expect(tabs.snapshots()[0]?.title).toBe("prod billing");
  });

  it("does not replace a custom title when the page title updates", () => {
    const { tabs, created } = createManager();
    const id = tabs.openTab({
      accountRoleKey: "111#Admin",
      url: "https://ap-northeast-1.console.aws.amazon.com/s3/home",
    });
    tabs.renameTab(id, "prod billing");
    emitPageTitle(created[0]!, "AWS Management Console");
    expect(tabs.snapshots()[0]?.title).toBe("prod billing");
  });

  it("follows page titles again after the custom title is cleared", () => {
    const { tabs, created } = createManager();
    const id = tabs.openTab({
      accountRoleKey: "111#Admin",
      url: "https://ap-northeast-1.console.aws.amazon.com/s3/home",
    });
    tabs.renameTab(id, "prod billing");
    tabs.renameTab(id, "   ");
    emitPageTitle(created[0]!, "Amazon S3");
    expect(tabs.snapshots()[0]?.title).toBe("Amazon S3");
  });

  it("restores a persisted custom title", () => {
    const { tabs } = createManager();
    tabs.restorePersisted([{ ...saved, customTitle: "my s3" }]);
    expect(tabs.snapshots()[0]?.title).toBe("my s3");
  });

  it("uses the account name as the default tab title", () => {
    const { tabs } = createManager({
      getAccountName: () => "Enjin",
    });
    tabs.openTab({
      accountRoleKey: "111#Admin",
      url: "https://ap-northeast-1.console.aws.amazon.com/s3/home",
    });
    expect(tabs.snapshots()[0]?.title).toBe("Enjin");
  });

  it("keeps the account name when the console page title updates", () => {
    const { tabs, created } = createManager({
      getAccountName: () => "Enjin",
    });
    tabs.openTab({
      accountRoleKey: "111#Admin",
      url: "https://ap-northeast-1.console.aws.amazon.com/s3/home",
    });
    emitPageTitle(created[0]!, "AWS Management Console");
    expect(tabs.snapshots()[0]?.title).toBe("Enjin");
  });

  it("falls back to the account name after a custom title is cleared", () => {
    const { tabs, created } = createManager({
      getAccountName: () => "Enjin",
    });
    const id = tabs.openTab({
      accountRoleKey: "111#Admin",
      url: "https://ap-northeast-1.console.aws.amazon.com/s3/home",
    });
    tabs.renameTab(id, "billing");
    tabs.renameTab(id, "");
    emitPageTitle(created[0]!, "Amazon S3");
    expect(tabs.snapshots()[0]?.title).toBe("Enjin");
  });
});
