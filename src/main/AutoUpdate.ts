export const GITHUB_FEED = {
  provider: "github" as const,
  owner: "sudabon",
  repo: "web_brAWSer",
};

export type UpdaterPort = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  forceDevUpdateConfig: boolean;
  logger: unknown;
  setFeedURL: (options: typeof GITHUB_FEED) => void;
  checkForUpdates: () => Promise<unknown>;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

export async function configureAutoUpdate(
  updater: UpdaterPort,
  options: {
    packaged: boolean;
    logError: (error: unknown) => void;
  },
): Promise<void> {
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.forceDevUpdateConfig = false;
  updater.on("error", (error: unknown) => {
    options.logError(error);
  });
  if (!options.packaged) {
    return;
  }
  updater.setFeedURL(GITHUB_FEED);
  try {
    await updater.checkForUpdates();
  } catch (error) {
    options.logError(error);
  }
}

export function resolveAutoUpdater(mod: unknown): UpdaterPort | undefined {
  if (!mod || typeof mod !== "object") {
    return undefined;
  }
  const record = mod as Record<string, unknown>;
  const fromNamed = asUpdaterPort(record.autoUpdater);
  if (fromNamed) {
    return fromNamed;
  }
  const defaultExport = record.default;
  if (!defaultExport || typeof defaultExport !== "object") {
    return undefined;
  }
  return asUpdaterPort((defaultExport as Record<string, unknown>).autoUpdater);
}

export async function startAutoUpdate(): Promise<void> {
  const logError = (error: unknown) => {
    console.error("auto-update failed", error);
  };
  try {
    const mod = await import("electron-updater");
    const { app } = await import("electron");
    const updater = resolveAutoUpdater(mod);
    if (!updater) {
      logError(new Error("electron-updater autoUpdater is unavailable"));
      return;
    }
    await configureAutoUpdate(updater, {
      packaged: app.isPackaged,
      logError,
    });
  } catch (error) {
    logError(error);
  }
}

function asUpdaterPort(value: unknown): UpdaterPort | undefined {
  if (!value || typeof value !== "object" || !("autoDownload" in value)) {
    return undefined;
  }
  return value as UpdaterPort;
}
