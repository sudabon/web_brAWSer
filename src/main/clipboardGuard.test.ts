import { describe, expect, it, vi } from "vitest";
import { ClipboardGuard } from "./clipboardGuard.ts";

describe("ClipboardGuard", () => {
  it("clears the clipboard after the delay when the copied value remains", () => {
    let text = "other";
    let scheduled: (() => void) | undefined;
    const guard = new ClipboardGuard(
      {
        writeText: (value) => {
          text = value;
        },
        readText: () => text,
        clear: () => {
          text = "";
        },
      },
      30_000,
      ((handler: () => void) => {
        scheduled = handler;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      vi.fn() as unknown as typeof clearTimeout,
    );

    guard.copy("123456");
    expect(text).toBe("123456");
    scheduled?.();
    expect(text).toBe("");
  });

  it("does not clear when the clipboard was overwritten", () => {
    let text = "";
    let scheduled: (() => void) | undefined;
    const guard = new ClipboardGuard(
      {
        writeText: (value) => {
          text = value;
        },
        readText: () => text,
        clear: () => {
          text = "";
        },
      },
      30_000,
      ((handler: () => void) => {
        scheduled = handler;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      vi.fn() as unknown as typeof clearTimeout,
    );

    guard.copy("123456");
    text = "unrelated";
    scheduled?.();
    expect(text).toBe("unrelated");
  });
});
