export type ShortcutId =
  | "toggle-side-panel"
  | "switch-account"
  | "toggle-totp"
  | "devtools-content"
  | "devtools-ui"
  | "new-tab"
  | "close-tab"
  | "select-tab-1"
  | "select-tab-2"
  | "select-tab-3"
  | "select-tab-4"
  | "select-tab-5"
  | "select-tab-6"
  | "select-tab-7"
  | "select-tab-8"
  | "select-tab-9"
  | "prev-tab"
  | "next-tab"
  | "reload"
  | "find"
  | "command-palette"
  | "switch-region";

export type ShortcutBinding = {
  id: ShortcutId;
  accelerator: string;
  label: string;
};

export const SHORTCUTS: ShortcutBinding[] = [
  { id: "toggle-side-panel", accelerator: "CommandOrControl+B", label: "Toggle Side Panel" },
  { id: "switch-account", accelerator: "Shift+CommandOrControl+A", label: "Switch Account" },
  { id: "toggle-totp", accelerator: "Shift+CommandOrControl+T", label: "Toggle TOTP Panel" },
  {
    id: "devtools-content",
    accelerator: "Alt+CommandOrControl+I",
    label: "Toggle Content DevTools",
  },
  {
    id: "devtools-ui",
    accelerator: "Alt+CommandOrControl+Shift+I",
    label: "Toggle App UI DevTools",
  },
  { id: "new-tab", accelerator: "CommandOrControl+T", label: "New Tab" },
  { id: "close-tab", accelerator: "CommandOrControl+W", label: "Close Tab" },
  { id: "select-tab-1", accelerator: "CommandOrControl+1", label: "Tab 1" },
  { id: "select-tab-2", accelerator: "CommandOrControl+2", label: "Tab 2" },
  { id: "select-tab-3", accelerator: "CommandOrControl+3", label: "Tab 3" },
  { id: "select-tab-4", accelerator: "CommandOrControl+4", label: "Tab 4" },
  { id: "select-tab-5", accelerator: "CommandOrControl+5", label: "Tab 5" },
  { id: "select-tab-6", accelerator: "CommandOrControl+6", label: "Tab 6" },
  { id: "select-tab-7", accelerator: "CommandOrControl+7", label: "Tab 7" },
  { id: "select-tab-8", accelerator: "CommandOrControl+8", label: "Tab 8" },
  { id: "select-tab-9", accelerator: "CommandOrControl+9", label: "Tab 9" },
  { id: "prev-tab", accelerator: "Shift+CommandOrControl+[", label: "Previous Tab" },
  { id: "next-tab", accelerator: "Shift+CommandOrControl+]", label: "Next Tab" },
  { id: "reload", accelerator: "CommandOrControl+R", label: "Reload" },
  { id: "find", accelerator: "CommandOrControl+F", label: "Find" },
  { id: "command-palette", accelerator: "CommandOrControl+K", label: "Command Palette" },
  { id: "switch-region", accelerator: "Alt+CommandOrControl+R", label: "Switch Region" },
];

export function duplicateAccelerators(
  bindings: readonly ShortcutBinding[] = SHORTCUTS,
): string[] {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const binding of bindings) {
    const previous = seen.get(binding.accelerator);
    if (previous) {
      duplicates.push(binding.accelerator);
    } else {
      seen.set(binding.accelerator, binding.id);
    }
  }
  return duplicates;
}

export function assertUniqueShortcuts(
  bindings: readonly ShortcutBinding[] = SHORTCUTS,
): void {
  const duplicates = duplicateAccelerators(bindings);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate shortcut accelerators: ${duplicates.join(", ")}`);
  }
}

export class ShortcutRegistry {
  readonly bindings: readonly ShortcutBinding[];

  constructor(bindings: readonly ShortcutBinding[] = SHORTCUTS) {
    assertUniqueShortcuts(bindings);
    this.bindings = bindings;
  }

  get(id: ShortcutId): ShortcutBinding {
    const found = this.bindings.find((binding) => binding.id === id);
    if (!found) {
      throw new Error(`Unknown shortcut: ${id}`);
    }
    return found;
  }
}
