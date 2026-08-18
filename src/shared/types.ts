export type TabSnapshot = {
  id: string;
  accountRoleKey: string;
  url: string;
  title: string;
  favicon?: string;
  hibernated: boolean;
  active: boolean;
};

export type PanelSnapshot = {
  collapsed: boolean;
  width: number;
};

export type WorkspaceSnapshot = {
  hibernateAfterMs: number;
};

export type FindResult = {
  matches: number;
  activeMatch: number;
};

export type OpenTabRequest = {
  accountRoleKey: string;
  url: string;
};

export type AccountTag = "prod" | "stg" | "dev" | "sandbox";

export const ACCOUNT_TAGS: AccountTag[] = ["prod", "stg", "dev", "sandbox"];

export const DEFAULT_ACCOUNT_REGION = "ap-northeast-1";

export const ACCOUNT_COLORS = [
  "#7aa2ff",
  "#7ee0a3",
  "#f0c674",
  "#e88b8b",
  "#c792ea",
  "#82d2e0",
  "#f0a36b",
  "#9aa7ff",
] as const;

export type AccountRoleView = {
  accountId: string;
  accountName: string;
  roleName: string;
  accountRoleKey: string;
  partition: string;
  color: string;
  tags: AccountTag[];
  defaultRegion: string;
};

export type SsoStatus =
  | "unconfigured"
  | "signed-out"
  | "authorizing"
  | "signed-in"
  | "error";

export type SsoSessionView = {
  status: SsoStatus;
  startUrl?: string;
  region?: string;
  expiresAt?: number;
  remainingMs?: number;
  errorMessage?: string;
  encryptionAvailable: boolean;
};

export type ConsoleSessionView = {
  accountRoleKey: string;
  connected: boolean;
  expiration?: number;
  connectedAt?: number;
  remainingMs?: number;
};

export type DirectorySnapshot = {
  sso: SsoSessionView;
  accounts: AccountRoleView[];
  sessions: ConsoleSessionView[];
  selectedAccountRoleKey: string | null;
  refreshing: boolean;
  reauthRequired: boolean;
  reauthMessage?: string;
};

export type SsoConfigureRequest = {
  startUrl: string;
  region: string;
};

export type AccountSettingsUpdate = {
  accountId: string;
  color?: string;
  tags?: AccountTag[];
  defaultRegion?: string;
};

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export type TotpSeed = {
  id: string;
  issuer: string;
  label: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
};

export type TotpCodeView = {
  id: string;
  issuer: string;
  label: string;
  code: string;
  remainingSeconds: number;
  period: number;
};

export type TotpSnapshot = {
  locked: boolean;
  encryptionAvailable: boolean;
  touchIdAvailable: boolean;
  seedCount: number;
  codes: TotpCodeView[];
  errorMessage?: string;
};

export type TotpManualImport = {
  issuer: string;
  label: string;
  secret: string;
};

export const IPC = {
  tabsList: "tabs:list",
  tabsOpen: "tabs:open",
  tabsSelect: "tabs:select",
  tabsClose: "tabs:close",
  tabsChanged: "tabs:changed",
  tabsRename: "tabs:rename",
  panelGet: "panel:get",
  panelSetCollapsed: "panel:set-collapsed",
  panelSetWidth: "panel:set-width",
  panelChanged: "panel:changed",
  directoryGet: "directory:get",
  directoryRefresh: "directory:refresh",
  directoryChanged: "directory:changed",
  ssoConfigure: "sso:configure",
  ssoStartAuth: "sso:start-auth",
  sessionsConnect: "sessions:connect",
  sessionsSelect: "sessions:select",
  accountsUpdate: "accounts:update",
  paletteOpen: "palette:open",
  totpGet: "totp:get",
  totpUnlock: "totp:unlock",
  totpImportUri: "totp:import-uri",
  totpImportSecret: "totp:import-secret",
  totpImportJson: "totp:import-json",
  totpImportImage: "totp:import-image",
  totpCaptureQr: "totp:capture-qr",
  totpCopy: "totp:copy",
  totpChanged: "totp:changed",
  totpTogglePanel: "totp:toggle-panel",
  totpCurrentCode: "totp:current-code",
  commandPaletteOpen: "command:open",
  commandJump: "command:jump",
  findOpen: "find:open",
  findQuery: "find:query",
  findStop: "find:stop",
  findResult: "find:result",
  regionPickerOpen: "region:open",
  regionSwitch: "region:switch",
  workspaceGet: "workspace:get",
  workspaceSetHibernate: "workspace:set-hibernate",
  urlHandoffTakePending: "url-handoff:take-pending",
  urlHandoffCancelPending: "url-handoff:cancel-pending",
  urlHandoffOpenInAccount: "url-handoff:open-in-account",
  urlHandoffRegisterProtocol: "url-handoff:register-protocol",
} as const;
