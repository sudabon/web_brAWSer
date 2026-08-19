import { contextBridge, ipcRenderer } from "electron";
import {
  ACCOUNT_COLOR_IPC,
  accountColorFromArgv,
} from "../shared/accountColor.ts";
import {
  isSsoPortalPartition,
  partitionFromArgv,
  TOTP_CURRENT_CODE_IPC,
} from "../shared/mfaAssist.ts";
import { startAccountColorBar } from "./account-color-bar.ts";
import { startMfaAssist } from "./mfa-assist.ts";
import { startSigninAssist } from "./signin-assist.ts";

const partition = partitionFromArgv(process.argv);

const api: {
  totp?: { currentCode: () => Promise<string> };
} = {};

if (isSsoPortalPartition(partition)) {
  api.totp = {
    currentCode: () => ipcRenderer.invoke(TOTP_CURRENT_CODE_IPC) as Promise<string>,
  };
}

contextBridge.exposeInMainWorld("brawserAws", api);

const colorBar = startAccountColorBar(
  document,
  accountColorFromArgv(process.argv),
  true,
);
ipcRenderer.on(ACCOUNT_COLOR_IPC, (_event, color: string) => {
  if (typeof color === "string" && color) {
    colorBar.setColor(color);
  }
});

startMfaAssist({
  partition,
  invokeCurrentCode: () => ipcRenderer.invoke(TOTP_CURRENT_CODE_IPC) as Promise<string>,
});

// 保存済みのサインイン情報は preload 内のボタンからのみ使う。
// contextBridge には出さない（ページ側の JS から読めてしまうため）。
startSigninAssist({ partition });
