## Why

現状 TOTP は Chrome 拡張 Authenticator に依存しており、ブラウザを本アプリへ分離した時点で使えなくなる。SSO セッション確立時（1日1回程度）に MFA コードが必要なため、これが欠けると本アプリ単体で作業が完結しない。

TOTP をアプリに内蔵することで、Identity Center へのサインインがアプリ内で完結する。

## What Changes

- `TotpStore` をメインプロセスに追加し、シードを `totp.enc`（`safeStorage` 暗号化、macOS では Keychain 由来の鍵）に保管する
- 初回参照時に Touch ID（`systemPreferences.promptTouchID()`）で解錠し、以降はメモリ保持、スリープ復帰でロックする
- シードのインポート経路を実装する:
  1. 画面上の QR を範囲選択で取り込む（`screencapture -i` → `zxing-wasm` でデコード）— macOS で最も実用的
  2. 画像ファイルのドラッグ&ドロップ
  3. `otpauth://` URI の貼り付け
  4. Base32 シークレットの直接入力
  5. Chrome 拡張 Authenticator のバックアップ JSON インポート（移行用）
- `otpauth` ライブラリ（RFC 6238）でコードを生成し、サイドパネルに現在のコードと残り秒数のリングを表示する。クリックでクリップボードへコピーし、30秒後に自動クリアする
- **自動入力はしない。** Identity Center のサインインページ**に限り**、preload から MFA 入力欄を検出して「入力する」ボタンをオーバーレイ表示し、ワンクリックで挿入する。**自動送信もしない**
- `Cmd+Shift+T` で TOTP パネルを開閉する

`otpauth-migration://offline?data=<base64 protobuf>`（Google Authenticator エクスポート形式）は protobuf デコードが必要なため本 change のスコープ外とする。

## Capabilities

### New Capabilities

- `totp-vault`: TOTP シードのインポート（QR範囲選択・画像・URI・Base32・Authenticator JSON）、`safeStorage` による暗号化保管、Touch ID ゲートによる解錠とスリープ復帰時の再ロック。
- `totp-input-assist`: RFC 6238 に基づくコード生成と残り時間表示、クリップボードへのコピーと自動クリア、Identity Center サインインページ限定の MFA 入力ボタン提示（自動入力・自動送信はしない）。

### Modified Capabilities

なし

## Impact

| 対象 | 内容 |
|---|---|
| 新規ファイル | `src/main/TotpStore.ts`, `src/main/QrCapture.ts`, `src/renderer/TotpPanel.tsx`, `src/preload/mfa-assist.ts` |
| 新規依存 | `otpauth`, `zxing-wasm` |
| 前提 | `sso-account-directory` の SSO サインイン画面（`persist:sso-portal`）が存在すること |
| プラットフォーム | `screencapture -i` は macOS 依存。他OS対応は非目標 |
| **セキュリティ上の重大な注意** | 本アプリは第1要素（コンソールを開く手段）と第2要素（TOTPシード）を同一プロセスに同居させる。アプリまたはユーザーディレクトリが侵害された時点で MFA は防御として機能しない。**ルートアカウントおよびブレークグラス用のシードは本アプリに入れない**方針を仕様として明記する |
| 署名 | 未署名だと起動のたびに Keychain プロンプトが出る。常用には ad-hoc 署名以上が必要（`packaging-and-url-handoff` で対応） |
