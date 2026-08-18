## Why

AWS Console Browser の価値は「アカウント数の制限なく同時サインイン状態を維持できる」という一点に依存し、それは技術的には次の前提の上に成り立つ。

> SSO の accessToken から `accountId × roleName` ごとに federation サインインURLを生成し、専用パーティションの WebView でそこへナビゲートする。

この前提が成立しなければ、後続のすべてのマイルストーン（Electron シェル、サイドバー、TOTP、永続化）は無価値になる。したがって**アプリのシェルを書くより先に**、50行規模のスクリプトでフローの成立を実証し、プロジェクト継続可否の判断ゲートとする。

## What Changes

- Node.js + TypeScript のリポジトリ基盤（`package.json` / `tsconfig.json`）を新設する
- 検証スパイク `spike/federation-spike.ts` を追加し、`RegisterClient` → `StartDeviceAuthorization` → `CreateToken` → `ListAccounts` / `ListAccountRoles` → `GetRoleCredentials` → `getSigninToken` → login URL 生成までを一気通貫で実行する
- 生成した login URL を実際にブラウザで開き、コンソールに入れることを人手で確認する
- **2つ以上のアカウントの login URL を、別Cookieジャー（Chromeの別プロファイル）で同時に開けること**を確認する — パーティション分離という設計全体の前提を検証する
- `SessionDuration` の可否、コンソールセッションの実測持続時間、CloudShell の動作、Identity Center の FIDO2 必須設定有無を実測し、検証レポート `spike/RESULTS.md` に記録する
- スパイクのコアロジックを、後続マイルストーンでそのまま再利用できる純関数群として切り出す（Electron 非依存）

## Capabilities

### New Capabilities

- `sso-federation-signin`: IAM Identity Center の device authorization でアクセストークンを取得し、アカウント×ロールを列挙し、一時認証情報から AWS マネジメントコンソールの federation サインインURLを生成する一連のフロー。一時認証情報をディスクに書かず、生成したサインインURLを再利用しないことを含む。

### Modified Capabilities

なし（本リポジトリ最初の change であり、既存 spec は存在しない）

## Impact

| 対象 | 内容 |
|---|---|
| 新規ファイル | `package.json`, `tsconfig.json`, `spike/federation-spike.ts`, `spike/RESULTS.md` |
| 新規依存 | `@aws-sdk/client-sso-oidc`, `@aws-sdk/client-sso`, `typescript`, `tsx`（実行用） |
| 外部システム | AWS IAM Identity Center（device auth が許可されている必要がある）、`signin.aws.amazon.com` |
| 前提 | 検証対象の Identity Center ポータル URL とアカウントが最低2つ利用できること |
| **ゲート** | 本 change の検証が NG の場合、`electron-app-shell` 以降の change は着手せず、純正マルチセッション（5セッション上限）へのフォールバック検討に切り替える |
| セキュリティ | 一時認証情報とサインイントークンを扱う。ログ・ファイルへの出力を禁止する |
