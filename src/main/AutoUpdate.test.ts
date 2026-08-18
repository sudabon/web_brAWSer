import { describe, expect, it, vi } from "vitest";
import { configureAutoUpdate, GITHUB_FEED, resolveAutoUpdater } from "./AutoUpdate.ts";

function createUpdater() {
  const events = new Map<string, Array<(...args: unknown[]) => void>>();
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    forceDevUpdateConfig: false,
    logger: null as unknown,
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => null),
    on(event: string, listener: (...args: unknown[]) => void) {
      const list = events.get(event) ?? [];
      list.push(listener);
      events.set(event, list);
      return updater;
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of events.get(event) ?? []) {
        listener(...args);
      }
    },
  };
  return updater;
}

describe("GITHUB_FEED", () => {
  it("uses HTTPS GitHub Releases", () => {
    expect(GITHUB_FEED.provider).toBe("github");
    expect(GITHUB_FEED.owner).toBe("sudabon");
    expect(GITHUB_FEED.repo).toBe("web_brAWSer");
    expect(GITHUB_FEED.provider).not.toBe("generic");
  });
});

describe("configureAutoUpdate", () => {
  it("does not check when unpackaged", async () => {
    const updater = createUpdater();
    const errors: unknown[] = [];
    await configureAutoUpdate(updater, {
      packaged: false,
      logError: (error) => errors.push(error),
    });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("checks on startup, keeps autoInstallOnAppQuit, and never force-restarts", async () => {
    const updater = createUpdater();
    await configureAutoUpdate(updater, {
      packaged: true,
      logError: () => {},
    });
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.autoDownload).toBe(true);
    expect(updater.forceDevUpdateConfig).toBe(false);
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.setFeedURL).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "github",
        owner: "sudabon",
        repo: "web_brAWSer",
      }),
    );
  });

  it("records feed failures and continues without throwing", async () => {
    const updater = createUpdater();
    updater.checkForUpdates.mockRejectedValue(new Error("ENOTFOUND"));
    const errors: string[] = [];
    await expect(
      configureAutoUpdate(updater, {
        packaged: true,
        logError: (error) => errors.push(String(error)),
      }),
    ).resolves.toBeUndefined();
    expect(errors.join(" ")).toMatch(/ENOTFOUND|update/i);
  });

  it("records updater error events without applying an update", async () => {
    const updater = createUpdater();
    const errors: string[] = [];
    await configureAutoUpdate(updater, {
      packaged: true,
      logError: (error) => errors.push(String(error)),
    });
    updater.emit("error", new Error("signature verification failed"));
    expect(errors.join(" ")).toMatch(/signature verification failed/);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
});

describe("resolveAutoUpdater", () => {
  it("reads autoUpdater from the CJS default export getter", () => {
    const updater = createUpdater();
    const mod = {
      default: {
        get autoUpdater() {
          return updater;
        },
      },
    };
    expect(resolveAutoUpdater(mod)).toBe(updater);
  });

  it("reads autoUpdater from a named ESM export when present", () => {
    const updater = createUpdater();
    expect(resolveAutoUpdater({ autoUpdater: updater })).toBe(updater);
  });

  it("returns undefined when the module has no updater", () => {
    expect(resolveAutoUpdater({})).toBeUndefined();
    expect(resolveAutoUpdater(undefined)).toBeUndefined();
  });
});
