import { describe, expect, it } from "vitest";
import {
  SHORTCUTS,
  ShortcutRegistry,
  assertUniqueShortcuts,
  duplicateAccelerators,
} from "./ShortcutRegistry.ts";

describe("ShortcutRegistry", () => {
  it("rejects duplicate accelerators", () => {
    expect(
      duplicateAccelerators([
        { id: "new-tab", accelerator: "CommandOrControl+T", label: "New Tab" },
        { id: "close-tab", accelerator: "CommandOrControl+T", label: "Close Tab" },
      ]),
    ).toEqual(["CommandOrControl+T"]);
    expect(() =>
      assertUniqueShortcuts([
        { id: "new-tab", accelerator: "CommandOrControl+T", label: "New Tab" },
        { id: "close-tab", accelerator: "CommandOrControl+T", label: "Close Tab" },
      ]),
    ).toThrow(/Duplicate shortcut/);
  });

  it("registers the app shortcuts without duplicates", () => {
    const registry = new ShortcutRegistry();
    expect(duplicateAccelerators(SHORTCUTS)).toEqual([]);
    expect(registry.get("toggle-side-panel").accelerator).toBe("CommandOrControl+B");
    expect(registry.get("switch-account").accelerator).toBe("Shift+CommandOrControl+A");
    expect(registry.get("toggle-totp").accelerator).toBe("Shift+CommandOrControl+T");
    expect(registry.get("devtools-content").accelerator).toBe("Alt+CommandOrControl+I");
    expect(registry.get("devtools-ui").accelerator).toBe("Alt+CommandOrControl+Shift+I");
    expect(registry.get("command-palette").accelerator).toBe("CommandOrControl+K");
  });
});
