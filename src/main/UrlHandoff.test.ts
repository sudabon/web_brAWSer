import { describe, expect, it, vi } from "vitest";
import {
  CUSTOM_SCHEME,
  UrlHandoff,
  decideHandoff,
  extractAccountId,
  extractUrlFromArgv,
  normalizeHandoffUrl,
} from "./UrlHandoff.ts";

const ACCOUNTS = [
  { accountId: "111111111111", accountRoleKey: "111111111111#Admin" },
  { accountId: "222222222222", accountRoleKey: "222222222222#ReadOnly" },
  { accountId: "222222222222", accountRoleKey: "222222222222#Admin" },
];

describe("normalizeHandoffUrl", () => {
  it("passes through https URLs", () => {
    expect(normalizeHandoffUrl("https://ap-northeast-1.console.aws.amazon.com/s3")).toBe(
      "https://ap-northeast-1.console.aws.amazon.com/s3",
    );
  });

  it("converts aws-console://host/path to https", () => {
    expect(normalizeHandoffUrl("aws-console://console.aws.amazon.com/s3/home")).toBe(
      "https://console.aws.amazon.com/s3/home",
    );
  });

  it("unwraps aws-console://open?url=", () => {
    const inner = "https://ap-northeast-1.console.aws.amazon.com/ec2/home";
    expect(normalizeHandoffUrl(`aws-console://open?url=${encodeURIComponent(inner)}`)).toBe(inner);
  });

  it("unwraps aws-console:https://... wrappers", () => {
    expect(normalizeHandoffUrl("aws-console:https://signin.aws.amazon.com/")).toBe(
      "https://signin.aws.amazon.com/",
    );
  });

  it("returns null for empty or unparseable input", () => {
    expect(normalizeHandoffUrl("")).toBeNull();
    expect(normalizeHandoffUrl("not a url")).toBeNull();
  });
});

describe("extractAccountId", () => {
  it("reads a 12-digit account from the hostname", () => {
    expect(extractAccountId("https://111111111111.signin.aws.amazon.com/console")).toBe(
      "111111111111",
    );
    expect(
      extractAccountId("https://111111111111-alias.ap-northeast-1.console.aws.amazon.com/"),
    ).toBe("111111111111");
  });

  it("reads account_id from query and hash (SSO start)", () => {
    expect(
      extractAccountId(
        "https://d-example.awsapps.com/start/#/console?account_id=111111111111&role_name=Admin",
      ),
    ).toBe("111111111111");
    expect(
      extractAccountId("https://console.aws.amazon.com/go?accountId=111111111111"),
    ).toBe("111111111111");
  });

  it("reads the account from an ARN", () => {
    expect(
      extractAccountId(
        "https://console.aws.amazon.com/go/view?arn=arn:aws:iam::111111111111:role/Admin",
      ),
    ).toBe("111111111111");
  });

  it("returns undefined when the URL has no account", () => {
    expect(extractAccountId("https://ap-northeast-1.console.aws.amazon.com/s3/buckets")).toBeUndefined();
  });
});

describe("decideHandoff", () => {
  it("opens in the unique matching partition", () => {
    expect(
      decideHandoff("https://111111111111.signin.aws.amazon.com/console", ACCOUNTS),
    ).toEqual({
      action: "open",
      url: "https://111111111111.signin.aws.amazon.com/console",
      accountRoleKey: "111111111111#Admin",
    });
  });

  it("shows the palette when multiple roles match the accountId", () => {
    expect(
      decideHandoff("https://console.aws.amazon.com/?accountId=222222222222", ACCOUNTS),
    ).toEqual({
      action: "palette",
      url: "https://console.aws.amazon.com/?accountId=222222222222",
    });
  });

  it("shows the palette when accountId is missing or unknown", () => {
    expect(
      decideHandoff("https://ap-northeast-1.console.aws.amazon.com/s3/buckets", ACCOUNTS),
    ).toEqual({
      action: "palette",
      url: "https://ap-northeast-1.console.aws.amazon.com/s3/buckets",
    });
    expect(
      decideHandoff("https://console.aws.amazon.com/?accountId=999999999999", ACCOUNTS),
    ).toEqual({
      action: "palette",
      url: "https://console.aws.amazon.com/?accountId=999999999999",
    });
  });

  it("delegates disallowed URLs to the default browser", () => {
    expect(decideHandoff("https://github.com/sudabon/web_brAWSer", ACCOUNTS)).toEqual({
      action: "external",
      url: "https://github.com/sudabon/web_brAWSer",
    });
  });

  it("normalizes the custom scheme before deciding", () => {
    expect(
      decideHandoff("aws-console://console.aws.amazon.com/?accountId=111111111111", ACCOUNTS),
    ).toEqual({
      action: "open",
      url: "https://console.aws.amazon.com/?accountId=111111111111",
      accountRoleKey: "111111111111#Admin",
    });
  });
});

describe("extractUrlFromArgv", () => {
  it("finds aws-console and allowed https URLs", () => {
    expect(
      extractUrlFromArgv(["/path/to/electron", "aws-console://console.aws.amazon.com/s3"]),
    ).toBe("aws-console://console.aws.amazon.com/s3");
    expect(
      extractUrlFromArgv(["electron", "https://ap-northeast-1.console.aws.amazon.com/ec2"]),
    ).toBe("https://ap-northeast-1.console.aws.amazon.com/ec2");
  });

  it("ignores unrelated https arguments", () => {
    expect(extractUrlFromArgv(["electron", "https://github.com/example"])).toBeUndefined();
  });
});

describe("UrlHandoff", () => {
  function createApp() {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    return {
      requestSingleInstanceLock: vi.fn(() => true),
      quit: vi.fn(),
      setAsDefaultProtocolClient: vi.fn(() => true),
      on(event: string, listener: (...args: unknown[]) => void) {
        const list = listeners.get(event) ?? [];
        list.push(listener);
        listeners.set(event, list);
        return this;
      },
      emit(event: string, ...args: unknown[]) {
        for (const listener of listeners.get(event) ?? []) {
          listener(...args);
        }
      },
    };
  }

  it("queues URLs received before the host is attached and flushes after ready", async () => {
    const app = createApp();
    const opened: { accountRoleKey: string; url: string }[] = [];
    const handoff = new UrlHandoff({
      app,
      openExternal: async () => {},
      argv: [],
      packaged: true,
      execPath: "/app",
    });
    expect(handoff.acquireInstanceLock()).toBe(true);
    handoff.listen();
    const event = { preventDefault: vi.fn() };
    app.emit("open-url", event, "aws-console://console.aws.amazon.com/?accountId=111111111111");
    expect(event.preventDefault).toHaveBeenCalled();
    expect(opened).toHaveLength(0);

    await handoff.attach({
      focusWindow: () => {},
      accounts: () => ACCOUNTS,
      openInAccount: async (accountRoleKey, url) => {
        opened.push({ accountRoleKey, url });
      },
      showPalette: () => {},
    });
    expect(opened).toEqual([
      {
        accountRoleKey: "111111111111#Admin",
        url: "https://console.aws.amazon.com/?accountId=111111111111",
      },
    ]);
  });

  it("does not guess an account: missing accountId opens the palette", async () => {
    const app = createApp();
    const handoff = new UrlHandoff({
      app,
      openExternal: async () => {},
      argv: [],
      packaged: true,
      execPath: "/app",
    });
    handoff.acquireInstanceLock();
    handoff.listen();
    let palette = 0;
    await handoff.attach({
      focusWindow: () => {},
      accounts: () => ACCOUNTS,
      openInAccount: async () => {
        throw new Error("must not open");
      },
      showPalette: () => {
        palette += 1;
      },
    });
    await handoff.handleRaw("https://ap-northeast-1.console.aws.amazon.com/s3/buckets");
    expect(palette).toBe(1);
    expect(handoff.takePending()).toBe(
      "https://ap-northeast-1.console.aws.amazon.com/s3/buckets",
    );
  });

  it("delegates disallowed URLs with shell.openExternal and does not open a tab", async () => {
    const app = createApp();
    const externals: string[] = [];
    const handoff = new UrlHandoff({
      app,
      openExternal: async (url) => {
        externals.push(url);
      },
      argv: [],
      packaged: true,
      execPath: "/app",
    });
    handoff.acquireInstanceLock();
    await handoff.attach({
      focusWindow: () => {},
      accounts: () => ACCOUNTS,
      openInAccount: async () => {
        throw new Error("must not open");
      },
      showPalette: () => {
        throw new Error("must not palette");
      },
    });
    await handoff.handleRaw("aws-console://github.com/sudabon/web_brAWSer");
    expect(externals).toEqual(["https://github.com/sudabon/web_brAWSer"]);
  });

  it("forwards a second-instance URL to the existing window", async () => {
    const app = createApp();
    const focused: string[] = [];
    const opened: { accountRoleKey: string; url: string }[] = [];
    const handoff = new UrlHandoff({
      app,
      openExternal: async () => {},
      argv: [],
      packaged: true,
      execPath: "/app",
    });
    expect(handoff.acquireInstanceLock()).toBe(true);
    handoff.listen();
    await handoff.attach({
      focusWindow: () => {
        focused.push("yes");
      },
      accounts: () => ACCOUNTS,
      openInAccount: async (accountRoleKey, url) => {
        opened.push({ accountRoleKey, url });
      },
      showPalette: () => {},
    });
    app.emit("second-instance", {}, [
      "app",
      "aws-console://console.aws.amazon.com/?accountId=111111111111",
    ]);
    await vi.waitFor(() => {
      expect(opened).toHaveLength(1);
    });
    expect(focused.length).toBeGreaterThanOrEqual(1);
    expect(opened).toEqual([
      {
        accountRoleKey: "111111111111#Admin",
        url: "https://console.aws.amazon.com/?accountId=111111111111",
      },
    ]);
  });

  it("quits when the instance lock is not acquired", () => {
    const app = createApp();
    app.requestSingleInstanceLock.mockReturnValue(false);
    const handoff = new UrlHandoff({
      app,
      openExternal: async () => {},
      argv: [],
      packaged: true,
      execPath: "/app",
    });
    expect(handoff.acquireInstanceLock()).toBe(false);
    expect(app.quit).toHaveBeenCalled();
  });

  it("registers the custom scheme", () => {
    const app = createApp();
    const handoff = new UrlHandoff({
      app,
      openExternal: async () => {},
      argv: [],
      packaged: true,
      execPath: "/Applications/WEBbrAWSer.app",
    });
    handoff.registerProtocol();
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith(CUSTOM_SCHEME);
  });
});
