import { describe, expect, it, vi } from "vitest";
import type { RoleCredentials, SsoGateway } from "./FederationService.ts";
import { SessionManager, type TabHost } from "./SessionManager.ts";

const credentials: RoleCredentials = {
  accessKeyId: "AKIATEST",
  secretAccessKey: "secret",
  sessionToken: "session",
  expiration: new Date("2026-08-15T16:00:00Z"),
};

function gateway(): SsoGateway {
  return {
    async listAccounts() {
      return { accountList: [] };
    },
    async listAccountRoles() {
      return { roleList: [] };
    },
    async getRoleCredentials() {
      return credentials;
    },
  };
}

function tabHost(): TabHost & {
  opened: { accountRoleKey: string; url: string }[];
  focused: string[];
  navigated: { id: string; url: string }[];
  tabs: { id: string; accountRoleKey: string; url: string }[];
} {
  const host = {
    opened: [] as { accountRoleKey: string; url: string }[],
    focused: [] as string[],
    navigated: [] as { id: string; url: string }[],
    tabs: [] as { id: string; accountRoleKey: string; url: string }[],
    openTab(accountRoleKey: string, url: string) {
      const tab = { id: `tab-${host.tabs.length + 1}`, accountRoleKey, url };
      host.tabs.push(tab);
      host.opened.push({ accountRoleKey, url });
      return tab.id;
    },
    focusAccount(accountRoleKey: string) {
      host.focused.push(accountRoleKey);
    },
    tabsFor(accountRoleKey: string) {
      return host.tabs.filter((tab) => tab.accountRoleKey === accountRoleKey);
    },
    navigateTab(id: string, url: string) {
      host.navigated.push({ id, url });
      const tab = host.tabs.find((item) => item.id === id);
      if (tab) {
        tab.url = url;
      }
    },
  };
  return host;
}

describe("SessionManager", () => {
  it("maps accountRoleKey to persist:acct-<accountId>-<roleName>", () => {
    const manager = new SessionManager({
      ssoGateway: gateway(),
      getAccessToken: async () => "sso",
      fetchImpl: vi.fn(),
      tabs: tabHost(),
      defaultRegionFor: () => "ap-northeast-1",
    });
    expect(manager.partitionFor("123456789012#AdministratorAccess")).toBe(
      "persist:acct-123456789012-AdministratorAccess",
    );
  });

  it("federates and opens a tab without retaining the login URL", async () => {
    const tabs = tabHost();
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ SigninToken: "tok" }), { status: 200 }),
    );
    const manager = new SessionManager({
      ssoGateway: gateway(),
      getAccessToken: async () => "sso",
      fetchImpl,
      tabs,
      defaultRegionFor: () => "ap-northeast-1",
      now: () => Date.parse("2026-08-15T12:00:00Z"),
    });

    await manager.connect("123456789012#AdministratorAccess");

    expect(tabs.opened).toHaveLength(1);
    expect(tabs.opened[0]?.url).toContain("Action=login");
    expect(tabs.opened[0]?.url).toContain("SigninToken=tok");
    expect(manager.viewFor("123456789012#AdministratorAccess")?.connected).toBe(true);
    expect(JSON.stringify(manager.snapshot())).not.toMatch(
      /SigninToken|loginUrl|AKIATEST|secretAccessKey|sessionToken/,
    );
  });

  it("opens another console tab for a live session without federating again", async () => {
    const tabs = tabHost();
    const getRoleCredentials = vi.fn(async () => credentials);
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ SigninToken: "tok" }), { status: 200 }),
    );
    const manager = new SessionManager({
      ssoGateway: { ...gateway(), getRoleCredentials },
      getAccessToken: async () => "sso",
      fetchImpl,
      tabs,
      defaultRegionFor: () => "ap-northeast-1",
      now: () => Date.parse("2026-08-15T12:00:00Z"),
    });

    await manager.connect("111#Admin");
    await manager.connect("111#Admin");

    expect(getRoleCredentials).toHaveBeenCalledOnce();
    expect(tabs.focused).toEqual(["111#Admin", "111#Admin"]);
    expect(tabs.opened).toHaveLength(2);
    expect(tabs.opened[1]?.url).toBe(
      "https://ap-northeast-1.console.aws.amazon.com/console/home?region=ap-northeast-1",
    );
  });

  it("silently re-federates an expired tab back to its current URL", async () => {
    const tabs = tabHost();
    tabs.tabs.push({
      id: "tab-1",
      accountRoleKey: "111#Admin",
      url: "https://ap-northeast-1.console.aws.amazon.com/ec2/home",
    });
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ SigninToken: "tok-2" }), { status: 200 }),
    );
    const manager = new SessionManager({
      ssoGateway: gateway(),
      getAccessToken: async () => "sso",
      fetchImpl,
      tabs,
      defaultRegionFor: () => "ap-northeast-1",
      now: () => Date.parse("2026-08-15T17:00:00Z"),
    });
    manager.seedSession({
      accountRoleKey: "111#Admin",
      expiration: Date.parse("2026-08-15T16:00:00Z"),
      connectedAt: Date.parse("2026-08-15T12:00:00Z"),
    });

    await manager.handleTabInteraction("111#Admin");

    expect(tabs.navigated[0]?.url).toContain(
      encodeURIComponent("https://ap-northeast-1.console.aws.amazon.com/ec2/home"),
    );
  });

  it("stops silent re-federation after 3 failures and asks for reauth", async () => {
    const tabs = tabHost();
    tabs.tabs.push({
      id: "tab-1",
      accountRoleKey: "111#Admin",
      url: "https://console.aws.amazon.com/",
    });
    const manager = new SessionManager({
      ssoGateway: {
        ...gateway(),
        getRoleCredentials: async () => {
          throw new Error("boom");
        },
      },
      getAccessToken: async () => "sso",
      fetchImpl: vi.fn(),
      tabs,
      defaultRegionFor: () => "ap-northeast-1",
      now: () => Date.parse("2026-08-15T17:00:00Z"),
    });
    manager.seedSession({
      accountRoleKey: "111#Admin",
      expiration: Date.parse("2026-08-15T16:00:00Z"),
      connectedAt: Date.parse("2026-08-15T12:00:00Z"),
    });

    await manager.handleTabInteraction("111#Admin");
    await manager.handleTabInteraction("111#Admin");
    await manager.handleTabInteraction("111#Admin");
    await manager.handleTabInteraction("111#Admin");

    expect(manager.snapshot().reauthRequired).toBe(true);
    expect(manager.snapshot().reauthMessage).toMatch(/再認証/);
  });

  it("opens a handed-off URL in a live session without federating", async () => {
    const tabs = tabHost();
    const getRoleCredentials = vi.fn(async () => credentials);
    const manager = new SessionManager({
      ssoGateway: { ...gateway(), getRoleCredentials },
      getAccessToken: async () => "sso",
      fetchImpl: vi.fn(),
      tabs,
      defaultRegionFor: () => "ap-northeast-1",
      now: () => Date.parse("2026-08-15T12:00:00Z"),
    });
    manager.seedSession({
      accountRoleKey: "111#Admin",
      expiration: Date.parse("2026-08-15T16:00:00Z"),
      connectedAt: Date.parse("2026-08-15T12:00:00Z"),
    });

    await manager.openUrl("111#Admin", "https://ap-northeast-1.console.aws.amazon.com/s3/home");

    expect(getRoleCredentials).not.toHaveBeenCalled();
    expect(tabs.opened).toEqual([
      { accountRoleKey: "111#Admin", url: "https://ap-northeast-1.console.aws.amazon.com/s3/home" },
    ]);
  });

  it("federates to the handed-off URL when the session is not connected", async () => {
    const tabs = tabHost();
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ SigninToken: "tok" }), { status: 200 }),
    );
    const manager = new SessionManager({
      ssoGateway: gateway(),
      getAccessToken: async () => "sso",
      fetchImpl,
      tabs,
      defaultRegionFor: () => "ap-northeast-1",
      now: () => Date.parse("2026-08-15T12:00:00Z"),
    });

    await manager.openUrl(
      "123456789012#AdministratorAccess",
      "https://ap-northeast-1.console.aws.amazon.com/ec2/home",
    );

    expect(tabs.opened).toHaveLength(1);
    expect(tabs.opened[0]?.url).toContain(
      encodeURIComponent("https://ap-northeast-1.console.aws.amazon.com/ec2/home"),
    );
  });
});
