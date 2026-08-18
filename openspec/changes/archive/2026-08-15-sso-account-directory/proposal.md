## Why

本アプリの主役機能を実装する。現状 Identity Center 運用では「ポータル → アカウント選択 → ロール選択 → 新規タブ」が切替のたびに発生し、開いたタブは他アプリのタブに埋もれる。

解決の要は、**アカウント×ロールの一覧をタブではなくサイドバーとして持つ**ことにある。40アカウントあってもタブは消費されず、表示されるタブは「今選択中のアカウントに属するもの」だけになる。加えて `verify-sso-federation-spike` で確立した federation フローをアプリに統合し、サイドバーのワンクリックで追加ログインなしにコンソールへ入れるようにする。

## What Changes

- `SsoManager` をメインプロセスに追加し、device authorization フロー（TOTP入力が必要なのはここ1回だけ）をアプリ内の専用パーティション `persist:sso-portal` で完結させる
- SSO の登録情報とトークンを `sso.enc`（`safeStorage` 暗号化）に永続化し、起動時に復元する。`refreshToken` があれば再認証より先に試す
- `ListAccounts` / `ListAccountRoles` の結果をキャッシュし、サイドバーに `accountId × roleName` のツリーを構築する（手動リフレッシュ可）
- アカウントごとに **色 / タグ(prod|stg|dev|sandbox) / 既定リージョン** をユーザーが設定でき、`config.json` に保存する
- サイドバー項目のクリックで `GetRoleCredentials` → `getSigninToken` → login URL 生成 → `persist:acct-<accountId>-<roleName>` パーティションのタブでナビゲート、までを自動実行する
- `GetRoleCredentials` の `expiration` を保持し、サイドバーに残り時間を表示する（残り10分で黄色、期限切れで灰色）
- 期限切れタブの操作時に、SSO accessToken が生きていれば federation を無言で再実行し、直前のURLへ戻す
- `Cmd+Shift+A` で fuzzy 検索付きアカウント切替パレットを開く — **本アプリの主役機能**

## Capabilities

### New Capabilities

- `account-directory`: SSO セッションの確立と維持、アカウント×ロール一覧の取得・キャッシュ・表示、アカウント単位のユーザー設定（色・タグ・既定リージョン）、fuzzy 検索による切替パレット。
- `console-session-lifecycle`: アカウント×ロールごとの専用パーティション割当、federation によるコンソール接続、認証情報の有効期限追跡と表示、期限切れ時の無言再接続、SSO トークン失効時の再認証。

### Modified Capabilities

なし（`sso-federation-signin` のフロー自体は変更せず、本 change はそれを呼び出す側の能力を追加する）

## Impact

| 対象 | 内容 |
|---|---|
| 新規ファイル | `src/main/SsoManager.ts`, `src/main/FederationService.ts`, `src/main/SessionManager.ts`, `src/renderer/Sidebar.tsx`, `src/renderer/AccountPalette.tsx` |
| 再利用 | `verify-sso-federation-spike` で切り出した Electron 非依存の federation ロジック |
| 新規依存 | fuzzy 検索ライブラリ（`fuse.js` 等） |
| 前提 | `electron-app-shell` の `TabManager` / パーティション指定が動作していること |
| セキュリティ | 一時認証情報（AccessKey/Secret/SessionToken）はメインプロセスのメモリのみに置き、レンダラへ渡さず、ディスクにもログにも出さない。SigninToken は使用後即破棄する |
| 未確定 | `SessionDuration` の可否は `verify-sso-federation-spike` の実測結果に従う |
