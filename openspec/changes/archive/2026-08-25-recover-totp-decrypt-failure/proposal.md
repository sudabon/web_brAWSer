## Why

safeStorage の暗号鍵は macOS Keychain のサービス名（＝アプリ名）に紐づく。`productName: WEBbrAWSer` の導入で鍵名が `web-brawser Safe Storage` から `WEBbrAWSer Safe Storage` へ変わった一方、userData フォルダは `src/main/main.ts:64` で `web-brawser` に固定されたため、改名前に書かれた `totp.enc` だけが旧鍵のまま同じフォルダに取り残された。結果 `TotpStore.unlock()` の `decryptString()` が常に例外を投げ、コード表示・コピー・全インポート経路（QR 画像のドラッグ＆ドロップを含む）が `Error while decrypting the ciphertext provided to safeStorage.decryptString.` で失敗する。

さらに `unlock()` が成功しない限り `#importDrafts()` も `#persist()` も到達できないため、新しい鍵で保存し直す経路が存在しない。利用者が UI から復旧する手段がなく、TOTP 機能が永久に使用不能になる。

## What Changes

- `TotpStore` に「復号不能（unreadable）」状態を追加し、解錠の失敗（認証キャンセル）と復号の失敗を区別して利用者に提示する
- 利用者が明示的に実行する「リセットして再登録」導線（IPC `totp:reset`）を追加する。既存 `totp.enc` は削除せずタイムスタンプ付きで退避し、空のシード一覧で解錠状態にする
- 復号失敗時にシードを自動破棄してはならないことを要件として固定する。`decryptString()` の失敗は鍵の変更だけでなく Keychain のロックやアクセス拒否でも起こり得るため、自動リセットは一時障害で MFA シードを黙って失う事故になる
- TOTP パネルは復号不能状態のときだけリセット操作を提示し、実行前に確認を求める

### Non-goals

- 旧鍵で暗号化された既存 `totp.enc` の移行・復号は行わない（当該データは破棄してよいと判断済み）
- 暗号化ファイルへの鍵識別子の埋め込み、および鍵名変更をまたぐ自動移行の仕組みは本変更に含めない
- `CredentialStore` / `SsoManager` への同等の回復導線は対象外。現行鍵で復号できており実害がないため、必要になった時点で別変更として起票する
- `productName` および `app.setPath("userData", ...)` の変更は行わない

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `totp-vault`: 「Touch ID による解錠ゲート」要件は復号そのものが失敗した場合の振る舞いを規定していない。復号不能状態の提示、シードの自動破棄の禁止、利用者による明示リセットでの回復を要件として追加する

## Impact

- **主プロセス**: `src/main/TotpStore.ts`（unreadable 状態の保持、`reset()` の追加、`unlock()` の復号失敗経路）、`src/main/main.ts`（`totp:reset` の IPC ハンドラ登録、退避用のファイル操作の注入）
- **IPC / 型**: `src/shared/types.ts`（`IPC.totpReset`、`TotpSnapshot.unreadable`）、`src/preload/preload-ui.ts`、`src/renderer/env.d.ts`
- **レンダラー**: `src/renderer/TotpPanel.tsx`（復号不能時のリセット導線と確認）、`src/renderer/side-panel.css`
- **テスト**: `src/main/TotpStore.test.ts`（復号失敗時の状態、自動破棄しないこと、リセット後に再登録できること）
- **運用**: 既存の `~/Library/Application Support/web-brawser/totp.enc` は本変更の適用後に UI からリセットし、QR を再読み込みして登録し直す
- **依存関係**: 追加なし
