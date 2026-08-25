## 1. 型と IPC 経路の定義

- [x] 1.1 `src/shared/types.ts` の `IPC` に `totpReset: "totp:reset"` を追加する
- [x] 1.2 `src/shared/types.ts` の `TotpSnapshot` に `unreadable: boolean` を追加する
- [x] 1.3 `src/preload/preload-ui.ts` の `totp` に `reset(): Promise<boolean>` を追加する
- [x] 1.4 `src/renderer/env.d.ts` の `window.brawser.totp` 型に `reset` と `unreadable` を反映し、`pnpm typecheck:node` と `pnpm typecheck:web` が通ることを確認する

## 2. TotpStore の復号不能状態（TDD）

- [x] 2.1 `src/main/TotpStore.test.ts` に `decryptString` だけが throw する `SafeStoragePort`（`isEncryptionAvailable` は true、`encryptString` は正常）を追加する
- [x] 2.2 失敗するテストを追加する: 既存 `totp.enc` がある状態で `unlock()` が false を返し、`view()` が `unreadable: true` / `locked: true` / `seedCount: 0` / `codes: []` になる
- [x] 2.3 テストを追加する: 認証をキャンセルした場合（`gate(false)`）は `unreadable` が false のままである
- [x] 2.4 テストを追加する: 復号失敗の後も `totp.enc` の内容が削除・上書きされていない
- [x] 2.5 テストを追加する: 復号失敗の後、復号可能な `safeStorage` で解錠し直すと `unreadable` が解除され、既存シードのコードが表示される
- [x] 2.6 テストを追加する: `unreadable` 中の `importUri` / `importSecret` / `importBackup` が throw し、`totp.enc` が変更されない
- [x] 2.7 `TotpStore` に `#unreadable` を実装する: `unlock()` の catch で立て、復号成功・ファイル非存在・暗号化非対応の各経路で false に戻す。`#error` は原因（鍵が変わった可能性）と対処（リセットして再登録）を含む文面にし、`view()` に `unreadable` を含めて 2.2〜2.6 を通す

## 3. リセット操作（TDD）

- [x] 3.1 `TotpStoreOptions` に `renameFile: (from: string, to: string) => Promise<void>` を追加し、`TotpStore.test.ts` の `store()` ヘルパーに `files` Map 上で動く fake 実装を追加する
- [x] 3.2 失敗するテストを追加する: `unreadable` 状態で `reset()` を呼ぶと `totp.enc` が `totp.enc.bak.<epoch millis>` へ退避され、`view()` が `unreadable: false` / `locked: false` / `seedCount: 0` / `errorMessage: undefined` になる
- [x] 3.3 テストを追加する: `reset()` 後に `importUri()` すると現行の `safeStorage` で `totp.enc` が新規作成され、コードが表示される
- [x] 3.4 テストを追加する: `unreadable` でない状態の `reset()` は no-op であり、既存 `totp.enc` と `seedCount` が変化しない
- [x] 3.5 テストを追加する: `totp.enc` が存在しない状態の `reset()` が例外にならない
- [x] 3.6 テストを追加する: `reset()` の実行後に `onChange` が呼ばれる
- [x] 3.7 `TotpStore.reset()` を実装し、3.2〜3.6 を通す（退避後は `totp.enc` を書き込まず、次の `#persist()` に委ねる）

## 4. 主プロセスの配線

- [x] 4.1 `src/main/main.ts` の `TotpStore` 生成時に `renameFile`（`node:fs/promises` の `rename`）を渡す
- [x] 4.2 `registerIpc` の `handlers` 配列に `IPC.totpReset` を追加する
- [x] 4.3 `ipcMain.handle(IPC.totpReset, ...)` を追加する: `dialog.showMessageBox` で「退避して空にする」旨の確認を取り（`unlockGate` のフォールバックと同じ流儀、既定ボタンはキャンセル）、同意時のみ `current.totp.reset()` を呼び、実行有無を boolean で返す

## 5. レンダラーの導線

- [x] 5.1 `src/renderer/TotpPanel.tsx` で `totp.unreadable` のときだけ「リセットして再登録」ボタンを表示する
- [x] 5.2 押下時に `window.brawser.totp.reset()` を既存の `run()` 経由で呼び、完了後にスナップショットを取り直す
- [x] 5.3 `unreadable` のときはインポート系の操作（URI・手入力・JSON・QR 画像 D&D・画面範囲選択）を無効化し、先にリセットが必要である旨を提示する
- [x] 5.4 `src/renderer/side-panel.css` にリセットボタンのスタイルを追加し、既存の `.totp-error` と並べても破壊的操作だと分かる見た目にする

## 6. 検証

- [x] 6.1 `pnpm test` を実行し、全テストが通ることを確認する
- [x] 6.2 `pnpm typecheck:node` と `pnpm typecheck:web` を実行して型エラーがないことを確認する
- [x] 6.3 実機確認: 現在の（旧鍵で暗号化された）`~/Library/Application Support/web-brawser/totp.enc` のまま `pnpm dev` で起動し、復号不能である旨とリセットボタンが表示され、インポート操作が無効化されていることを確認する
- [x] 6.4 実機確認: 確認ダイアログをキャンセルした場合、`totp.enc` も画面の状態も変化しないことを確認する
- [x] 6.5 実機確認: リセットを実行し、`totp.enc.bak.<epoch millis>` が生成され `totp.enc` が消えること、画面が「シードはまだありません」の状態に戻ることを確認する
- [x] 6.6 実機確認: QR コード画像をドラッグ＆ドロップしてシードが登録され、コードが表示され、コピーできることを確認する
- [x] 6.7 実機確認: アプリを再起動し、Touch ID 解錠で登録済みシードが復号されること、復号不能の提示が出ないことを確認する
