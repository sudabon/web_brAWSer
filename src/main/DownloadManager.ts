import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import type { Event, Session } from "electron";

export type DownloadNotice = {
  kind: "completed" | "failed" | "cancelled";
  filename: string;
  savePath?: string;
};

export type DownloadManagerOptions = {
  homeDir?: string;
  aliasFor: (accountRoleKey: string) => string;
  exists?: (path: string) => boolean | Promise<boolean>;
  mkdir?: (path: string) => Promise<unknown>;
  notify: (notice: DownloadNotice) => void;
};

export function accountDownloadDir(homeDir: string, accountAlias: string): string {
  const safeAlias = accountAlias.replace(/[\\/]/g, "-") || "unknown";
  return join(homeDir, "Downloads", "AWS", safeAlias);
}

export async function uniqueDownloadPath(
  directory: string,
  filename: string,
  exists: (path: string) => boolean | Promise<boolean>,
): Promise<string> {
  const extension = extname(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  let index = 0;
  while (true) {
    const name = index === 0 ? filename : `${stem} (${index})${extension}`;
    const candidate = join(directory, name);
    if (!(await exists(candidate))) {
      return candidate;
    }
    index += 1;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export class DownloadManager {
  #sessions = new WeakSet<Session>();

  constructor(private readonly options: DownloadManagerOptions) {}

  attach(electronSession: Session, accountRoleKey: string): void {
    if (this.#sessions.has(electronSession)) {
      return;
    }
    this.#sessions.add(electronSession);
    electronSession.on("will-download", (_event: Event, item) => {
      void this.#route(item, accountRoleKey);
    });
  }

  async #route(
    item: {
      getFilename(): string;
      setSavePath(path: string): void;
      on(event: "done", listener: (_event: unknown, state: string) => void): void;
    },
    accountRoleKey: string,
  ): Promise<void> {
    const homeDir = this.options.homeDir ?? homedir();
    const alias = this.options.aliasFor(accountRoleKey);
    const directory = accountDownloadDir(homeDir, alias);
    await (this.options.mkdir ?? ((path: string) => mkdir(path, { recursive: true })))(
      directory,
    );
    const filename = item.getFilename() || "download";
    const exists = this.options.exists ?? pathExists;
    const savePath = await uniqueDownloadPath(directory, filename, exists);
    item.setSavePath(savePath);
    item.on("done", (_event, state) => {
      if (state === "completed") {
        this.options.notify({ kind: "completed", filename, savePath });
        return;
      }
      this.options.notify({
        kind: state === "cancelled" ? "cancelled" : "failed",
        filename,
        savePath,
      });
    });
  }
}
