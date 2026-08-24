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

/**
 * 1 つの機能の初期化が失敗しても、ほかの機能を巻き込まない。
 * preload が途中で投げると以降の行が丸ごと実行されず、原因の見えない不動作になる。
 */
function startFeature<T>(name: string, start: () => T): T | undefined {
  try {
    return start();
  } catch (error) {
    console.error(`[brAWSer] ${name} の初期化に失敗しました`, error);
    return undefined;
  }
}

const colorBar = startFeature("アカウント色バー", () =>
  startAccountColorBar(document, accountColorFromArgv(process.argv), true),
);
ipcRenderer.on(ACCOUNT_COLOR_IPC, (_event, color: string) => {
  if (typeof color === "string" && color) {
    colorBar?.setColor(color);
  }
});

startFeature("TOTP 入力補助", () =>
  startMfaAssist({
    partition,
    invokeCurrentCode: () => ipcRenderer.invoke(TOTP_CURRENT_CODE_IPC) as Promise<string>,
  }),
);

// 保存済みのサインイン情報は preload 内のボタンからのみ使う。
// contextBridge には出さない（ページ側の JS から読めてしまうため）。
startFeature("サインイン入力補助", () => startSigninAssist({ partition }));
