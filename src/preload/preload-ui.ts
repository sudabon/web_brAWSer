import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type AccountSettingsUpdate,
  type DirectorySnapshot,
  type OpenTabRequest,
  type PanelSnapshot,
  type SigninCredentialSave,
  type SigninCredentialSnapshot,
  type SsoConfigureRequest,
  type TabSnapshot,
  type TotpManualImport,
  type TotpSnapshot,
  type FindResult,
  type WorkspaceSnapshot,
} from "../shared/types.ts";

contextBridge.exposeInMainWorld("brawser", {
  tabs: {
    list: (): Promise<TabSnapshot[]> => ipcRenderer.invoke(IPC.tabsList),
    open: (request: OpenTabRequest): Promise<string> =>
      ipcRenderer.invoke(IPC.tabsOpen, request),
    select: (id: string): Promise<void> => ipcRenderer.invoke(IPC.tabsSelect, id),
    close: (id: string): Promise<void> => ipcRenderer.invoke(IPC.tabsClose, id),
    rename: (id: string, title: string): Promise<void> =>
      ipcRenderer.invoke(IPC.tabsRename, id, title),
    reorder: (id: string, toIndex: number): Promise<void> =>
      ipcRenderer.invoke(IPC.tabsReorder, id, toIndex),
    onChanged: (callback: (tabs: TabSnapshot[]) => void): (() => void) => {
      const listener = (_event: unknown, tabs: TabSnapshot[]): void => {
        callback(tabs);
      };
      ipcRenderer.on(IPC.tabsChanged, listener);
      return () => {
        ipcRenderer.removeListener(IPC.tabsChanged, listener);
      };
    },
  },
  panel: {
    getState: (): Promise<PanelSnapshot> => ipcRenderer.invoke(IPC.panelGet),
    setCollapsed: (collapsed: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.panelSetCollapsed, collapsed),
    setWidth: (width: number): Promise<void> =>
      ipcRenderer.invoke(IPC.panelSetWidth, width),
    onChanged: (callback: (state: PanelSnapshot) => void): (() => void) => {
      const listener = (_event: unknown, state: PanelSnapshot): void => {
        callback(state);
      };
      ipcRenderer.on(IPC.panelChanged, listener);
      return () => {
        ipcRenderer.removeListener(IPC.panelChanged, listener);
      };
    },
  },
  directory: {
    get: (): Promise<DirectorySnapshot> => ipcRenderer.invoke(IPC.directoryGet),
    refresh: (): Promise<void> => ipcRenderer.invoke(IPC.directoryRefresh),
    configureSso: (request: SsoConfigureRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.ssoConfigure, request),
    startAuth: (): Promise<void> => ipcRenderer.invoke(IPC.ssoStartAuth),
    connect: (accountRoleKey: string): Promise<void> =>
      ipcRenderer.invoke(IPC.sessionsConnect, accountRoleKey),
    select: (accountRoleKey: string): Promise<void> =>
      ipcRenderer.invoke(IPC.sessionsSelect, accountRoleKey),
    updateAccount: (update: AccountSettingsUpdate): Promise<void> =>
      ipcRenderer.invoke(IPC.accountsUpdate, update),
    onChanged: (callback: (snapshot: DirectorySnapshot) => void): (() => void) => {
      const listener = (_event: unknown, snapshot: DirectorySnapshot): void => {
        callback(snapshot);
      };
      ipcRenderer.on(IPC.directoryChanged, listener);
      return () => {
        ipcRenderer.removeListener(IPC.directoryChanged, listener);
      };
    },
    onPaletteOpen: (callback: () => void): (() => void) => {
      const listener = (): void => {
        callback();
      };
      ipcRenderer.on(IPC.paletteOpen, listener);
      return () => {
        ipcRenderer.removeListener(IPC.paletteOpen, listener);
      };
    },
  },
  totp: {
    get: (): Promise<TotpSnapshot> => ipcRenderer.invoke(IPC.totpGet),
    unlock: (): Promise<boolean> => ipcRenderer.invoke(IPC.totpUnlock),
    importUri: (uri: string): Promise<void> => ipcRenderer.invoke(IPC.totpImportUri, uri),
    importSecret: (input: TotpManualImport): Promise<void> =>
      ipcRenderer.invoke(IPC.totpImportSecret, input),
    importJson: (raw: string): Promise<number> => ipcRenderer.invoke(IPC.totpImportJson, raw),
    importImage: (bytes: Uint8Array): Promise<void> =>
      ipcRenderer.invoke(IPC.totpImportImage, bytes),
    captureQr: (): Promise<void> => ipcRenderer.invoke(IPC.totpCaptureQr),
    copy: (id: string): Promise<string> => ipcRenderer.invoke(IPC.totpCopy, id),
    onChanged: (callback: (snapshot: TotpSnapshot) => void): (() => void) => {
      const listener = (_event: unknown, snapshot: TotpSnapshot): void => {
        callback(snapshot);
      };
      ipcRenderer.on(IPC.totpChanged, listener);
      return () => {
        ipcRenderer.removeListener(IPC.totpChanged, listener);
      };
    },
    onTogglePanel: (callback: () => void): (() => void) => {
      const listener = (): void => {
        callback();
      };
      ipcRenderer.on(IPC.totpTogglePanel, listener);
      return () => {
        ipcRenderer.removeListener(IPC.totpTogglePanel, listener);
      };
    },
  },
  credentials: {
    get: (): Promise<SigninCredentialSnapshot> => ipcRenderer.invoke(IPC.credentialsGet),
    unlock: (): Promise<boolean> => ipcRenderer.invoke(IPC.credentialsUnlock),
    save: (input: SigninCredentialSave): Promise<void> =>
      ipcRenderer.invoke(IPC.credentialsSave, input),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.credentialsRemove, id),
    onChanged: (callback: (snapshot: SigninCredentialSnapshot) => void): (() => void) => {
      const listener = (_event: unknown, snapshot: SigninCredentialSnapshot): void => {
        callback(snapshot);
      };
      ipcRenderer.on(IPC.credentialsChanged, listener);
      return () => {
        ipcRenderer.removeListener(IPC.credentialsChanged, listener);
      };
    },
  },
  urlHandoff: {
    takePending: (): Promise<string | undefined> =>
      ipcRenderer.invoke(IPC.urlHandoffTakePending),
    cancelPending: (): Promise<void> => ipcRenderer.invoke(IPC.urlHandoffCancelPending),
    openInAccount: (accountRoleKey: string, url: string): Promise<void> =>
      ipcRenderer.invoke(IPC.urlHandoffOpenInAccount, accountRoleKey, url),
    registerProtocol: (): Promise<void> => ipcRenderer.invoke(IPC.urlHandoffRegisterProtocol),
  },
  commands: {
    jump: (serviceId: string): Promise<void> => ipcRenderer.invoke(IPC.commandJump, serviceId),
    onOpen: (callback: () => void): (() => void) => {
      const listener = (): void => {
        callback();
      };
      ipcRenderer.on(IPC.commandPaletteOpen, listener);
      return () => ipcRenderer.removeListener(IPC.commandPaletteOpen, listener);
    },
  },
  find: {
    query: (text: string, findNext: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.findQuery, { text, findNext }),
    stop: (): Promise<void> => ipcRenderer.invoke(IPC.findStop),
    onOpen: (callback: () => void): (() => void) => {
      const listener = (): void => {
        callback();
      };
      ipcRenderer.on(IPC.findOpen, listener);
      return () => ipcRenderer.removeListener(IPC.findOpen, listener);
    },
    onResult: (callback: (result: FindResult) => void): (() => void) => {
      const listener = (_event: unknown, result: FindResult): void => {
        callback(result);
      };
      ipcRenderer.on(IPC.findResult, listener);
      return () => ipcRenderer.removeListener(IPC.findResult, listener);
    },
  },
  region: {
    switchTo: (region: string): Promise<void> => ipcRenderer.invoke(IPC.regionSwitch, region),
    onOpen: (callback: () => void): (() => void) => {
      const listener = (): void => {
        callback();
      };
      ipcRenderer.on(IPC.regionPickerOpen, listener);
      return () => ipcRenderer.removeListener(IPC.regionPickerOpen, listener);
    },
  },
  workspace: {
    get: (): Promise<WorkspaceSnapshot> => ipcRenderer.invoke(IPC.workspaceGet),
    setHibernateAfterMs: (ms: number): Promise<void> =>
      ipcRenderer.invoke(IPC.workspaceSetHibernate, ms),
  },
});
