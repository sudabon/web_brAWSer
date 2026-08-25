export {};

declare global {
  interface Window {
    brawser: {
      tabs: {
        list: () => Promise<import("../shared/types").TabSnapshot[]>;
        open: (request: import("../shared/types").OpenTabRequest) => Promise<string>;
        select: (id: string) => Promise<void>;
        close: (id: string) => Promise<void>;
        rename: (id: string, title: string) => Promise<void>;
        reorder: (id: string, toIndex: number) => Promise<void>;
        onChanged: (
          callback: (tabs: import("../shared/types").TabSnapshot[]) => void,
        ) => () => void;
      };
      panel: {
        getState: () => Promise<import("../shared/types").PanelSnapshot>;
        setCollapsed: (collapsed: boolean) => Promise<void>;
        setWidth: (width: number) => Promise<void>;
        onChanged: (
          callback: (state: import("../shared/types").PanelSnapshot) => void,
        ) => () => void;
      };
      directory: {
        get: () => Promise<import("../shared/types").DirectorySnapshot>;
        refresh: () => Promise<void>;
        configureSso: (
          request: import("../shared/types").SsoConfigureRequest,
        ) => Promise<void>;
        startAuth: () => Promise<void>;
        connect: (accountRoleKey: string) => Promise<void>;
        select: (accountRoleKey: string) => Promise<void>;
        updateAccount: (
          update: import("../shared/types").AccountSettingsUpdate,
        ) => Promise<void>;
        onChanged: (
          callback: (snapshot: import("../shared/types").DirectorySnapshot) => void,
        ) => () => void;
        onPaletteOpen: (callback: () => void) => () => void;
      };
      totp: {
        get: () => Promise<import("../shared/types").TotpSnapshot>;
        unlock: () => Promise<boolean>;
        importUri: (uri: string) => Promise<void>;
        importSecret: (input: import("../shared/types").TotpManualImport) => Promise<void>;
        importJson: (raw: string) => Promise<number>;
        importImage: (bytes: Uint8Array) => Promise<void>;
        captureQr: () => Promise<void>;
        copy: (id: string) => Promise<string>;
        reset: () => Promise<boolean>;
        onChanged: (
          callback: (snapshot: import("../shared/types").TotpSnapshot) => void,
        ) => () => void;
        onTogglePanel: (callback: () => void) => () => void;
      };
      credentials: {
        get: () => Promise<import("../shared/types").SigninCredentialSnapshot>;
        unlock: () => Promise<boolean>;
        save: (
          input: import("../shared/types").SigninCredentialSave,
        ) => Promise<void>;
        remove: (id: string) => Promise<void>;
        onChanged: (
          callback: (
            snapshot: import("../shared/types").SigninCredentialSnapshot,
          ) => void,
        ) => () => void;
      };
      urlHandoff: {
        takePending: () => Promise<string | undefined>;
        cancelPending: () => Promise<void>;
        openInAccount: (accountRoleKey: string, url: string) => Promise<void>;
        registerProtocol: () => Promise<void>;
      };
      commands: {
        jump: (serviceId: string) => Promise<void>;
        onOpen: (callback: () => void) => () => void;
      };
      find: {
        query: (text: string, findNext: boolean) => Promise<void>;
        stop: () => Promise<void>;
        onOpen: (callback: () => void) => () => void;
        onResult: (
          callback: (result: import("../shared/types").FindResult) => void,
        ) => () => void;
      };
      region: {
        switchTo: (region: string) => Promise<void>;
        onOpen: (callback: () => void) => () => void;
      };
      workspace: {
        get: () => Promise<import("../shared/types").WorkspaceSnapshot>;
        setHibernateAfterMs: (ms: number) => Promise<void>;
      };
    };
  }
}
