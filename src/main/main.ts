import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BaseWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  powerMonitor,
  safeStorage,
  screen,
  session,
  shell as electronShell,
  systemPreferences,
  WebContentsView,
} from "electron";
import { AppController } from "./AppController.ts";
import { startAutoUpdate } from "./AutoUpdate.ts";
import { ClipboardGuard } from "./clipboardGuard.ts";
import { DownloadManager } from "./DownloadManager.ts";
import { ShortcutRegistry, type ShortcutId } from "./ShortcutRegistry.ts";
import { UrlHandoff } from "./UrlHandoff.ts";
import { rewriteConsoleRegion } from "./consoleUrl.ts";
import { AWS_SERVICES, consoleServiceUrl } from "../shared/awsServices.ts";
import { parseAccountRoleKey } from "./accountRole.ts";
import { defaultDestination } from "./FederationService.ts";
import {
  clampPanelWidth,
  clampWindowSize,
  contentViewBounds,
  DEFAULT_PANEL_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  sidePanelBounds,
  type PanelLayoutState,
} from "./layout.ts";
import { captureQrFromScreen, decodeQrBuffer } from "./QrCapture.ts";
import { TabManager } from "./TabManager.ts";
import { TotpStore, type UnlockGate } from "./TotpStore.ts";
import { CredentialStore } from "./CredentialStore.ts";
import { SsoPortalPresenter } from "./SsoPortalPresenter.ts";
import { partitionFromAccountRoleKey, SSO_PORTAL_PARTITION } from "./partition.ts";
import { PersistenceStore } from "./PersistenceStore.ts";
import { SHELL_BACKGROUND_DARK, shellBackgroundColor } from "./theme.ts";
import {
  IPC,
  type AccountSettingsUpdate,
  type FindResult,
  type OpenTabRequest,
  type SigninCredentialSave,
  type SsoConfigureRequest,
  type TotpManualImport,
} from "../shared/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

app.enableSandbox();
// Keep the historical userData folder so renaming the product does not reset SSO / tabs.
app.setPath("userData", join(app.getPath("appData"), "web-brawser"));

type Shell = {
  window: BaseWindow;
  sidePanelView: WebContentsView;
  tabManager: TabManager;
  panel: PanelLayoutState;
  panelAttached: boolean;
  controller: AppController;
  portal: SsoPortalPresenter;
  totp: TotpStore;
  credentials: CredentialStore;
  downloads: DownloadManager;
  remainingTimer?: ReturnType<typeof setInterval>;
};

let shell: Shell | undefined;
let autoUpdateStarted = false;
let applyingWindowChrome = false;
let creatingShell = false;

const urlHandoff = new UrlHandoff({
  app: app as unknown as ConstructorParameters<typeof UrlHandoff>[0]["app"],
  openExternal: (url) => electronShell.openExternal(url),
  argv: process.argv,
  packaged: app.isPackaged,
  execPath: process.execPath,
  argv1: process.argv[1],
});

function docsPath(name: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "docs", name);
  }
  return join(__dirname, "../../docs", name);
}

function preloadPath(name: "preload-aws" | "preload-ui"): string {
  return join(__dirname, `../preload/${name}.cjs`);
}

function windowSize(window: BaseWindow): { width: number; height: number } {
  const [width, height] = window.getContentSize();
  return {
    width: Math.max(width, 800),
    height: Math.max(height, 600),
  };
}

function presentWindow(window: BaseWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.moveTop();
  window.focus();
  if (process.platform === "darwin") {
    app.dock?.show();
    app.focus({ steal: true });
  }
}

function layoutShell(current: Shell): void {
  const size = windowSize(current.window);
  const panelBounds = sidePanelBounds(size, current.panel);
  if (panelBounds) {
    if (!current.panelAttached) {
      current.window.contentView.addChildView(current.sidePanelView);
      current.panelAttached = true;
    }
    current.sidePanelView.setBounds(panelBounds);
  } else if (current.panelAttached) {
    current.window.contentView.removeChildView(current.sidePanelView);
    current.panelAttached = false;
  }
  current.tabManager.layout();
  current.portal.layout();
}

function broadcast(current: Shell): void {
  const contents = current.sidePanelView.webContents;
  contents.send(IPC.tabsChanged, current.tabManager.snapshots());
  contents.send(IPC.panelChanged, { ...current.panel });
  contents.send(IPC.directoryChanged, current.controller.snapshot());
  contents.send(IPC.totpChanged, current.totp.view());
  contents.send(IPC.credentialsChanged, current.credentials.view());
  applyWindowChrome(current);
}

function createMenu(current: Shell): void {
  const registry = new ShortcutRegistry();
  const click = (id: ShortcutId, action: () => void) => {
    const binding = registry.get(id);
    return {
      label: binding.label,
      accelerator: binding.accelerator,
      click: action,
    };
  };
  const isMac = process.platform === "darwin";
  const selectedKey = () => current.controller.snapshot().selectedAccountRoleKey;

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        click("new-tab", () => {
          const key = selectedKey();
          if (!key) {
            return;
          }
          const account = current.controller
            .snapshot()
            .accounts.find((item) => item.accountRoleKey === key);
          current.tabManager.openTab({
            accountRoleKey: key,
            url: defaultDestination(account?.defaultRegion ?? "ap-northeast-1"),
          });
        }),
        click("close-tab", () => {
          const id = current.tabManager.activeTab?.id;
          if (id) {
            current.tabManager.closeTab(id);
          }
        }),
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        click("toggle-side-panel", () => {
          current.panel.collapsed = !current.panel.collapsed;
          layoutShell(current);
          broadcast(current);
          persistWorkspace(current);
        }),
        click("command-palette", () => {
          current.sidePanelView.webContents.send(IPC.commandPaletteOpen);
        }),
        click("switch-account", () => {
          current.sidePanelView.webContents.send(IPC.paletteOpen);
        }),
        click("toggle-totp", () => {
          if (current.panel.collapsed) {
            current.panel.collapsed = false;
            layoutShell(current);
            broadcast(current);
            persistWorkspace(current);
          }
          current.sidePanelView.webContents.send(IPC.totpTogglePanel);
        }),
        click("switch-region", () => {
          current.sidePanelView.webContents.send(IPC.regionPickerOpen);
        }),
        click("find", () => {
          current.sidePanelView.webContents.send(IPC.findOpen);
        }),
        click("reload", () => {
          current.tabManager.reloadActive();
        }),
        { type: "separator" },
        ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((index) =>
          click(`select-tab-${index}`, () => {
            const key = selectedKey();
            if (key) {
              current.tabManager.selectAccountTabByIndex(key, index - 1);
            }
          }),
        ),
        click("prev-tab", () => {
          const key = selectedKey();
          if (key) {
            current.tabManager.cycleAccountTab(key, -1);
          }
        }),
        click("next-tab", () => {
          const key = selectedKey();
          if (key) {
            current.tabManager.cycleAccountTab(key, 1);
          }
        }),
        { type: "separator" },
        click("devtools-content", () => {
          current.tabManager.activeTab?.view?.webContents.openDevTools({
            mode: "right",
          });
        }),
        click("devtools-ui", () => {
          const contents = current.sidePanelView.webContents;
          if (contents.isDevToolsOpened()) {
            contents.closeDevTools();
          } else {
            contents.openDevTools({ mode: "detach" });
          }
        }),
      ],
    },
    {
      role: "window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }],
    },
    {
      role: "help",
      submenu: [
        {
          label: "AWS URL の受け取りを設定…",
          click: () => {
            urlHandoff.registerProtocol();
            void electronShell.openPath(docsPath("finicky-integration.md"));
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let panelPersistTimer: ReturnType<typeof setTimeout> | undefined;

function persistWorkspace(current: Shell): void {
  if (panelPersistTimer) {
    clearTimeout(panelPersistTimer);
  }
  panelPersistTimer = setTimeout(() => {
    void persistWorkspaceNow(current);
  }, 250);
}

function persistWorkspaceNow(current: Shell): void {
  if (current.window.isDestroyed()) {
    return;
  }
  const bounds = current.window.getBounds();
  void current.controller.config.updateWorkspace({
    panelCollapsed: current.panel.collapsed,
    panelWidth: current.panel.width,
    windowWidth: bounds.width,
    windowHeight: bounds.height,
  });
}

function accountColor(current: Shell, accountRoleKey: string | null | undefined): string | undefined {
  if (!accountRoleKey) {
    return undefined;
  }
  return current.controller
    .snapshot()
    .accounts.find((account) => account.accountRoleKey === accountRoleKey)?.color;
}

function applyWindowChrome(current: Shell): void {
  if (applyingWindowChrome) {
    return;
  }
  applyingWindowChrome = true;
  try {
    const key =
      current.tabManager.activeTab?.accountRoleKey ??
      current.controller.snapshot().selectedAccountRoleKey;
    const fallback = shellBackgroundColor(nativeTheme.shouldUseDarkColors);
    current.window.setBackgroundColor(accountColor(current, key) ?? fallback);
  } catch (error) {
    console.error("failed to apply window chrome", error);
  } finally {
    applyingWindowChrome = false;
  }
}

function accountAlias(current: Shell, accountRoleKey: string): string {
  const account = current.controller
    ?.snapshot()
    .accounts.find((item) => item.accountRoleKey === accountRoleKey);
  return account?.accountName ?? parseAccountRoleKey(accountRoleKey).accountId;
}

function registerIpc(current: Shell): void {
  const handlers = [
    IPC.tabsList,
    IPC.tabsOpen,
    IPC.tabsSelect,
    IPC.tabsClose,
    IPC.tabsRename,
    IPC.panelGet,
    IPC.panelSetCollapsed,
    IPC.panelSetWidth,
    IPC.directoryGet,
    IPC.directoryRefresh,
    IPC.ssoConfigure,
    IPC.ssoStartAuth,
    IPC.sessionsConnect,
    IPC.sessionsSelect,
    IPC.accountsUpdate,
    IPC.totpGet,
    IPC.totpUnlock,
    IPC.totpImportUri,
    IPC.totpImportSecret,
    IPC.totpImportJson,
    IPC.totpImportImage,
    IPC.totpCaptureQr,
    IPC.totpCopy,
    IPC.totpCurrentCode,
    IPC.commandJump,
    IPC.findQuery,
    IPC.findStop,
    IPC.regionSwitch,
    IPC.workspaceGet,
    IPC.workspaceSetHibernate,
    IPC.urlHandoffTakePending,
    IPC.urlHandoffCancelPending,
    IPC.urlHandoffOpenInAccount,
    IPC.urlHandoffRegisterProtocol,
  ] as const;
  for (const channel of handlers) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(IPC.tabsList, () => current.tabManager.snapshots());
  ipcMain.handle(IPC.tabsOpen, (_event, request: OpenTabRequest) => {
    return current.tabManager.openTab(request);
  });
  ipcMain.handle(IPC.tabsSelect, (_event, id: string) => {
    current.tabManager.selectTab(id);
  });
  ipcMain.handle(IPC.tabsClose, (_event, id: string) => {
    current.tabManager.closeTab(id);
  });
  ipcMain.handle(IPC.tabsRename, (_event, id: string, title: string) => {
    if (typeof id !== "string" || typeof title !== "string") {
      return;
    }
    current.tabManager.renameTab(id, title);
  });
  ipcMain.handle(IPC.panelGet, () => ({ ...current.panel }));
  ipcMain.handle(IPC.panelSetCollapsed, (_event, collapsed: boolean) => {
    current.panel.collapsed = collapsed;
    layoutShell(current);
    broadcast(current);
    persistWorkspace(current);
  });
  ipcMain.handle(IPC.panelSetWidth, (_event, width: number) => {
    current.panel.width = clampPanelWidth(width);
    layoutShell(current);
    broadcast(current);
    persistWorkspace(current);
  });
  ipcMain.handle(IPC.directoryGet, () => current.controller.snapshot());
  ipcMain.handle(IPC.directoryRefresh, () => current.controller.refreshDirectory());
  ipcMain.handle(IPC.ssoConfigure, (_event, request: SsoConfigureRequest) => {
    return current.controller.configureSso(request);
  });
  ipcMain.handle(IPC.ssoStartAuth, () => current.controller.startAuth());
  ipcMain.handle(IPC.sessionsConnect, (_event, accountRoleKey: string) => {
    return current.controller.connect(accountRoleKey);
  });
  ipcMain.handle(IPC.sessionsSelect, (_event, accountRoleKey: string) => {
    return current.controller.select(accountRoleKey);
  });
  ipcMain.handle(IPC.accountsUpdate, (_event, update: AccountSettingsUpdate) => {
    return current.controller.updateAccount(update).then(() => {
      if (update.color && update.accountId) {
        current.tabManager.applyAccountColor(update.accountId, update.color);
      }
      applyWindowChrome(current);
    });
  });
  ipcMain.handle(IPC.totpGet, () => current.totp.view());
  ipcMain.handle(IPC.totpUnlock, () => current.totp.unlock());
  ipcMain.handle(IPC.totpImportUri, (_event, uri: string) => current.totp.importUri(uri));
  ipcMain.handle(IPC.totpImportSecret, (_event, input: TotpManualImport) => {
    return current.totp.importSecret(input);
  });
  ipcMain.handle(IPC.totpImportJson, (_event, raw: string) => current.totp.importBackup(raw));
  ipcMain.handle(IPC.totpImportImage, async (_event, bytes: Uint8Array) => {
    const uri = await decodeQrBuffer(Buffer.from(bytes), {
      unlink: async () => {},
    });
    await current.totp.importUri(uri);
  });
  ipcMain.handle(IPC.totpCaptureQr, async () => {
    const uri = await captureQrFromScreen({
      tmpdir,
      joinPath: join,
      readFile,
      unlink,
    });
    await current.totp.importUri(uri);
  });
  ipcMain.handle(IPC.totpCopy, (_event, id: string) => current.totp.copy(id));
  ipcMain.handle(IPC.totpCurrentCode, (event) => {
    if (event.sender.session !== session.fromPartition(SSO_PORTAL_PARTITION)) {
      throw new Error("forbidden");
    }
    return current.totp.currentCodeForAssist();
  });
  ipcMain.handle(IPC.credentialsGet, () => current.credentials.view());
  ipcMain.handle(IPC.credentialsUnlock, () => current.credentials.unlock());
  ipcMain.handle(IPC.credentialsSave, (_event, input: SigninCredentialSave) => {
    return current.credentials.save(input);
  });
  ipcMain.handle(IPC.credentialsRemove, (_event, id: string) => current.credentials.remove(id));
  ipcMain.handle(IPC.credentialsFill, (event) => {
    if (event.sender.session !== session.fromPartition(SSO_PORTAL_PARTITION)) {
      throw new Error("forbidden");
    }
    return current.credentials.currentForAssist();
  });
  ipcMain.handle(IPC.commandJump, (_event, serviceId: string) => {
    const key = current.controller.snapshot().selectedAccountRoleKey;
    const service = AWS_SERVICES.find((item) => item.id === serviceId);
    if (!key || !service) {
      return;
    }
    const account = current.controller
      .snapshot()
      .accounts.find((item) => item.accountRoleKey === key);
    const url = consoleServiceUrl(account?.defaultRegion ?? "ap-northeast-1", service.path);
    const active = current.tabManager.activeTab;
    if (active && active.accountRoleKey === key) {
      current.tabManager.navigateTab(active.id, url);
      return;
    }
    current.tabManager.openTab({ accountRoleKey: key, url });
  });
  ipcMain.handle(IPC.findQuery, (_event, request: { text: string; findNext: boolean }) => {
    if (!request.text) {
      current.tabManager.stopFindInActive();
      return;
    }
    current.tabManager.findInActive(request.text, { findNext: request.findNext });
  });
  ipcMain.handle(IPC.findStop, () => {
    current.tabManager.stopFindInActive();
  });
  ipcMain.handle(IPC.regionSwitch, (_event, region: string) => {
    const active = current.tabManager.activeTab;
    if (!active?.url) {
      return;
    }
    current.tabManager.navigateTab(active.id, rewriteConsoleRegion(active.url, region));
  });
  ipcMain.handle(IPC.workspaceGet, () => current.controller.config.workspace());
  ipcMain.handle(IPC.workspaceSetHibernate, (_event, ms: number) => {
    current.tabManager.setHibernateAfterMs(ms);
    return current.controller.config.updateWorkspace({ hibernateAfterMs: ms });
  });
  ipcMain.handle(IPC.urlHandoffTakePending, () => urlHandoff.takePending());
  ipcMain.handle(IPC.urlHandoffCancelPending, () => {
    urlHandoff.cancelPending();
  });
  ipcMain.handle(IPC.urlHandoffOpenInAccount, (_event, accountRoleKey: string, url: string) => {
    return current.controller.sessions.openUrl(accountRoleKey, url);
  });
  ipcMain.handle(IPC.urlHandoffRegisterProtocol, () => {
    urlHandoff.registerProtocol();
  });
}

async function loadSidePanel(view: WebContentsView): Promise<void> {
  const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
  if (rendererUrl) {
    await view.webContents.loadURL(rendererUrl);
    return;
  }
  await view.webContents.loadFile(join(__dirname, "../renderer/index.html"));
}

async function createShell(): Promise<void> {
  if (shell) {
    presentWindow(shell.window);
    return;
  }
  if (creatingShell) {
    return;
  }
  creatingShell = true;
  let window: BaseWindow | undefined;
  try {
    const persistence = new PersistenceStore(app.getPath("userData"));
    await persistence.load();
    const saved = persistence.config();
    const size = clampWindowSize(
      saved.windowWidth,
      saved.windowHeight,
      screen.getPrimaryDisplay().workAreaSize,
    );
    window = new BaseWindow({
      width: size.width,
      height: size.height,
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      show: false,
      title: "WEBbrAWSer",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 12, y: 12 },
      backgroundColor: SHELL_BACKGROUND_DARK,
    });
    await setupShell(window);
  } catch (error) {
    if (window && !window.isDestroyed()) {
      window.close();
    }
    throw error;
  } finally {
    creatingShell = false;
  }
}

async function setupShell(window: BaseWindow): Promise<void> {
  const sidePanelView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      preload: preloadPath("preload-ui"),
    },
  });

  const panel: PanelLayoutState = {
    collapsed: false,
    width: DEFAULT_PANEL_WIDTH,
  };

  const current = {
    window,
    sidePanelView,
    panel,
    panelAttached: false,
  } as Shell;

  current.downloads = new DownloadManager({
    aliasFor: (accountRoleKey) => accountAlias(current, accountRoleKey),
    notify: (notice) => {
      const title =
        notice.kind === "completed"
          ? "ダウンロード完了"
          : notice.kind === "cancelled"
            ? "ダウンロードをキャンセルしました"
            : "ダウンロードに失敗しました";
      new Notification({
        title,
        body: notice.savePath ? `${notice.filename}\n${notice.savePath}` : notice.filename,
      }).show();
    },
  });

  current.tabManager = new TabManager({
    window,
    awsPreloadPath: preloadPath("preload-aws"),
    getWindowSize: () => windowSize(window),
    getPanelState: () => current.panel,
    onChange: () => broadcast(current),
    onInteract: (accountRoleKey) => {
      void current.controller.handleTabInteraction(accountRoleKey);
    },
    persistTabs: (tabs) => current.controller?.config.persistence.saveTabs(tabs),
    getAccountColor: (accountRoleKey) => accountColor(current, accountRoleKey),
    getAccountName: (accountRoleKey) => accountAlias(current, accountRoleKey),
    onViewCreated: (tab) => {
      if (!tab.view) {
        return;
      }
      current.downloads.attach(
        session.fromPartition(partitionFromAccountRoleKey(tab.accountRoleKey)),
        tab.accountRoleKey,
      );
      tab.view.webContents.on("found-in-page", (_event, result) => {
        const payload = result as { matches?: number; activeMatchOrdinal?: number };
        const message: FindResult = {
          matches: payload.matches ?? 0,
          activeMatch: payload.activeMatchOrdinal ?? 0,
        };
        current.sidePanelView.webContents.send(IPC.findResult, message);
      });
    },
  });

  current.portal = new SsoPortalPresenter({
    window,
    awsPreloadPath: preloadPath("preload-aws"),
    getBounds: () => contentViewBounds(windowSize(window), current.panel),
    onLayout: () => layoutShell(current),
  });

  current.controller = new AppController({
    userDataDir: app.getPath("userData"),
    ssoEncPath: join(app.getPath("userData"), "sso.enc"),
    safeStorage: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plain) => safeStorage.encryptString(plain),
      decryptString: (blob) => safeStorage.decryptString(blob),
    },
    presenter: current.portal,
    tabs: {
      openTab: (accountRoleKey, url) =>
        current.tabManager.openTab({ accountRoleKey, url }),
      focusAccount: (accountRoleKey) => current.tabManager.focusAccount(accountRoleKey),
      tabsFor: (accountRoleKey) => current.tabManager.tabsFor(accountRoleKey),
      navigateTab: (id, url) => current.tabManager.navigateTab(id, url),
    },
    onChange: () => broadcast(current),
  });

  const clipboardGuard = new ClipboardGuard(
    {
      writeText: (text) => clipboard.writeText(text),
      readText: () => clipboard.readText(),
      clear: () => clipboard.clear(),
    },
    30_000,
  );
  const unlockGate: UnlockGate = {
    canPromptBiometric: () =>
      process.platform === "darwin" && systemPreferences.canPromptTouchID(),
    promptUnlock: async (reason) => {
      if (process.platform === "darwin" && systemPreferences.canPromptTouchID()) {
        try {
          await systemPreferences.promptTouchID(reason);
          return true;
        } catch {
          return false;
        }
      }
      const result = await dialog.showMessageBox({
        type: "info",
        buttons: ["解錠", "キャンセル"],
        defaultId: 0,
        cancelId: 1,
        message: `${reason}しますか？`,
        detail:
          "この環境では Touch ID が使えないため、確認ダイアログで解錠します。Keychain 由来の暗号化はそのまま使われます。",
      });
      return result.response === 0;
    },
  };
  const readEncryptedFile = async (path: string): Promise<Buffer | null> => {
    try {
      return await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  };
  const writeEncryptedFile = async (path: string, data: Buffer): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  };
  current.credentials = new CredentialStore({
    credentialsEncPath: join(app.getPath("userData"), "creds.enc"),
    safeStorage: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plain) => safeStorage.encryptString(plain),
      decryptString: (blob) => safeStorage.decryptString(blob),
    },
    unlockGate,
    readFile: readEncryptedFile,
    writeFile: writeEncryptedFile,
    onChange: () => broadcast(current),
  });
  current.totp = new TotpStore({
    totpEncPath: join(app.getPath("userData"), "totp.enc"),
    safeStorage: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plain) => safeStorage.encryptString(plain),
      decryptString: (blob) => safeStorage.decryptString(blob),
    },
    unlockGate,
    clipboard: clipboardGuard,
    readFile: async (path) => {
      try {
        return await readFile(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    writeFile: async (path, data) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    onChange: () => broadcast(current),
  });

  sidePanelView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  window.contentView.addChildView(sidePanelView);
  current.panelAttached = true;
  layoutShell(current);
  registerIpc(current);
  createMenu(current);

  current.remainingTimer = setInterval(() => broadcast(current), 30_000);

  window.on("resize", () => {
    layoutShell(current);
    persistWorkspace(current);
  });
  window.on("close", () => {
    if (panelPersistTimer) {
      clearTimeout(panelPersistTimer);
    }
    persistWorkspaceNow(current);
  });
  window.on("closed", () => {
    if (current.remainingTimer) {
      clearInterval(current.remainingTimer);
    }
    current.tabManager.dispose();
    clipboardGuard.dispose();
    void current.portal.dismiss();
    sidePanelView.webContents.close();
    if (shell === current) {
      shell = undefined;
    }
  });

  shell = current;
  layoutShell(current);
  presentWindow(window);
  applyWindowChrome(current);
  layoutShell(current);
  await loadSidePanel(sidePanelView);
  layoutShell(current);
  await current.controller.start();
  const workspace = current.controller.config.workspace();
  current.panel.collapsed = workspace.panelCollapsed;
  current.panel.width = clampPanelWidth(workspace.panelWidth);
  current.tabManager.setHibernateAfterMs(workspace.hibernateAfterMs);
  current.tabManager.restorePersisted(current.controller.config.persistence.tabs());
  layoutShell(current);
  broadcast(current);
  await urlHandoff.attach({
    focusWindow: () => presentWindow(current.window),
    accounts: () => current.controller.snapshot().accounts,
    openInAccount: (accountRoleKey, url) => current.controller.sessions.openUrl(accountRoleKey, url),
    showPalette: () => {
      current.sidePanelView.webContents.send(IPC.paletteOpen);
    },
  });
  if (!autoUpdateStarted) {
    autoUpdateStarted = true;
    void startAutoUpdate();
  }
  presentWindow(window);
}

if (urlHandoff.acquireInstanceLock()) {
  urlHandoff.registerProtocol();
  urlHandoff.listen();

  app.whenReady().then(() => {
    nativeTheme.on("updated", () => {
      if (shell) {
        applyWindowChrome(shell);
      }
    });

    powerMonitor.on("resume", () => {
      shell?.totp.lock();
      shell?.credentials.lock();
    });

    void createShell().catch((error) => {
      console.error("failed to create application window", error);
    });

    app.on("activate", () => {
      if (shell) {
        presentWindow(shell.window);
        return;
      }
      void createShell().catch((error) => {
        console.error("failed to create application window", error);
      });
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
