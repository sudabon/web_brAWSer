import { describe, expect, it, vi } from "vitest";
import {
  DownloadManager,
  accountDownloadDir,
  uniqueDownloadPath,
} from "./DownloadManager.ts";

describe("accountDownloadDir", () => {
  it("places files under ~/Downloads/AWS/<accountAlias>/", () => {
    expect(accountDownloadDir("/Users/ada", "prod-web")).toBe(
      "/Users/ada/Downloads/AWS/prod-web",
    );
  });
});

describe("uniqueDownloadPath", () => {
  it("does not overwrite an existing file", async () => {
    const existing = new Set([
      "/tmp/AWS/prod-web/credentials.csv",
      "/tmp/AWS/prod-web/credentials (1).csv",
    ]);
    const path = await uniqueDownloadPath("/tmp/AWS/prod-web", "credentials.csv", (candidate) =>
      existing.has(candidate),
    );
    expect(path).toBe("/tmp/AWS/prod-web/credentials (2).csv");
  });
});

describe("DownloadManager", () => {
  it("sets the save path without a dialog and notifies completion", async () => {
    const notify = vi.fn();
    const mkdir = vi.fn(async () => {});
    const manager = new DownloadManager({
      homeDir: "/Users/ada",
      aliasFor: () => "prod-web",
      exists: () => false,
      mkdir,
      notify,
    });
    const item = {
      getFilename: () => "credentials.csv",
      setSavePath: vi.fn(),
      on: vi.fn(),
    };
    const session = {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        if (event === "will-download") {
          listener({}, item);
        }
      }),
    };
    manager.attach(session as never, "111#Admin");
    await vi.waitFor(() => expect(item.setSavePath).toHaveBeenCalled());
    expect(mkdir).toHaveBeenCalledWith("/Users/ada/Downloads/AWS/prod-web");
    expect(item.setSavePath).toHaveBeenCalledWith(
      "/Users/ada/Downloads/AWS/prod-web/credentials.csv",
    );
    const done = item.on.mock.calls.find((call) => call[0] === "done")?.[1] as (
      event: unknown,
      state: string,
    ) => void;
    done({}, "completed");
    expect(notify).toHaveBeenCalledWith({
      kind: "completed",
      filename: "credentials.csv",
      savePath: "/Users/ada/Downloads/AWS/prod-web/credentials.csv",
    });
  });

  it("notifies failure and cancellation instead of completion", async () => {
    const notify = vi.fn();
    const manager = new DownloadManager({
      homeDir: "/Users/ada",
      aliasFor: () => "prod-web",
      exists: () => false,
      mkdir: async () => {},
      notify,
    });
    const failedItem = {
      getFilename: () => "report.csv",
      setSavePath: vi.fn(),
      on: vi.fn(),
    };
    const session = {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        if (event === "will-download") {
          listener({}, failedItem);
        }
      }),
    };
    manager.attach(session as never, "111#Admin");
    await vi.waitFor(() => expect(failedItem.on).toHaveBeenCalled());
    const done = failedItem.on.mock.calls[0]?.[1] as (event: unknown, state: string) => void;
    done({}, "interrupted");
    expect(notify).toHaveBeenCalledWith({
      kind: "failed",
      filename: "report.csv",
      savePath: "/Users/ada/Downloads/AWS/prod-web/report.csv",
    });
  });
});
