import { shell, type WebContents } from "electron";
import { isAllowed } from "./NavigationGuard.ts";

export function attachNavigationGuard(
  contents: WebContents,
  onAllowedWindowOpen: (url: string) => void,
): void {
  contents.on("will-navigate", (event, url) => {
    if (isAllowed(url)) {
      return;
    }
    event.preventDefault();
    void openExternal(url);
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowed(url)) {
      onAllowedWindowOpen(url);
    } else {
      void openExternal(url);
    }
    return { action: "deny" };
  });
}

async function openExternal(url: string): Promise<void> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return;
    }
    await shell.openExternal(url);
  } catch {
    // Invalid URLs stay denied.
  }
}
