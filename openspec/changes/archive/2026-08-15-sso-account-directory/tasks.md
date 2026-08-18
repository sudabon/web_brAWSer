## 1. federation ロジックの取り込み

- [x] 1.1 `verify-sso-federation-spike` の `spike/federation.ts` を `src/main/FederationService.ts` へ移す
- [x] 1.2 Electron 依存が混入していないことを確認し、ユニットテスト可能な形を保つ
- [x] 1.3 `getSigninToken` の POST 実装と、`SigninToken` を使用後にメモリから破棄する処理を確認する

## 2. SSO セッション管理

- [x] 2.1 `src/main/SsoManager.ts` を作成し、`SsoState` 型（`startUrl` / `region` / `registration` / `accessToken` / `refreshToken` / `expiresAt`）を定義する
- [x] 2.2 `sso.enc` への `safeStorage` 暗号化保存と読み込みを実装する
- [x] 2.3 起動時の復元を実装する — 有効期限内の `accessToken` があれば device auth をスキップする
- [x] 2.4 device authorization フローを実装し、`verificationUriComplete` を `persist:sso-portal` パーティションのビューで開く
- [x] 2.5 `CreateToken` のポーリングを実装し、成功したら状態を保存する
- [x] 2.6 トークン失効時の3段階回復を実装する — `refreshToken` 更新 → device auth 再実行 → `RegisterClient` からやり直し
- [x] 2.7 SSO セッションの残り時間をサイドバーへ通知する IPC を実装する
- [x] 2.8 `safeStorage.isEncryptionAvailable()` が false の場合の扱いを決めて実装する

## 3. アカウント一覧

- [x] 3.1 `ListAccounts` / `ListAccountRoles` を呼び、アカウント×ロールのツリーを構築する
- [x] 3.2 `ListAccountRoles` を並列実行し、同時実行数の上限を設けてレート制限を避ける
- [x] 3.3 一覧を `config.json` にキャッシュする
- [x] 3.4 起動時はキャッシュで即描画し、バックグラウンドで更新する
- [x] 3.5 手動リフレッシュを実装する

## 4. アカウント設定

- [x] 4.1 `AccountRole` 型（`accountId` / `accountName` / `roleName` / `partition` / `color` / `tags` / `defaultRegion`）を定義する
- [x] 4.2 `config.json` の読み書きを実装する
- [x] 4.3 未設定アカウントへの既定値適用を実装する（既定リージョン `ap-northeast-1`、色の自動割当）
- [x] 4.4 色 / タグ（`prod` / `stg` / `dev` / `sandbox`）/ 既定リージョンの編集 UI を作る

## 5. セッションライフサイクル

- [x] 5.1 `src/main/SessionManager.ts` を作成し、`accountRoleKey`（`${accountId}#${roleName}`）とパーティション名の対応を管理する
- [x] 5.2 `electron-app-shell` のハードコードされたパーティション名を `SessionManager` からの供給に置き換える
- [x] 5.3 `connect(accountRoleKey)` を実装する — `GetRoleCredentials` → `getSigninToken` → `buildLoginUrl` → 専用パーティションのタブでナビゲート
- [x] 5.4 ログインURLを保存・キャッシュしないことをコードレビューで確認する
- [x] 5.5 `ConsoleSession` 型（`accountRoleKey` / `expiration` / `connectedAt`）で有効期限を保持する
- [x] 5.6 接続済みアカウントの再選択時は再認証せず既存タブを表示する
- [x] 5.7 期限切れタブ操作時の無言再federationを実装する — `Destination` に直前の URL を指定する
- [x] 5.8 無言再federationの再試行回数に上限を設け、超えたら利用者に再認証を促す

## 6. サイドバーと切替パレット

- [x] 6.1 `electron-app-shell` の `SidePanel.tsx` のアカウントセクションを実装し、アカウント×ロールのツリーを表示する
- [x] 6.2 接続状態（塗り = 接続中 / 輪郭 = 未接続）と色ドットを表示する
- [x] 6.3 有効期限の残り時間を表示する — 10分未満で黄色、期限切れで灰色
- [x] 6.4 SSO セッション残り時間をサイドパネル最上部に表示する
- [x] 6.5 クリックで接続を開始する導線を実装する
- [x] 6.6 依存に `fuse.js` を追加する
- [x] 6.7 `src/renderer/AccountPalette.tsx` を作成し、`accountName` / `accountId` / `roleName` に対する fuzzy 検索を実装する
- [x] 6.8 `Cmd+Shift+A` でパレットを開くショートカットを登録する
- [x] 6.9 タブセクションの表示を「現在選択中のアカウントに属するタブのみ」に絞り込む
- [x] 6.10 アカウントセクションが多数のアカウントでスクロールし、タブセクションと TOTP セクションの表示位置を押し出さないことを確認する

## 7. 認証情報の非公開の担保

- [x] 7.1 IPC のペイロード型を定義し、一時認証情報を含む型をレンダラ側に export しないことを確認する
- [x] 7.2 `config.json` / `sso.enc` に一時認証情報が含まれないことを確認する
- [x] 7.3 ログ出力に認証情報・`SigninToken` が現れないことを確認する

## 8. 検証

- [x] 8.1 初回起動から SSO サインイン（MFA 入力1回）を経てサイドバーが表示されることを確認する
- [x] 8.2 アプリを再起動し、MFA 入力なしでサイドバーが復元されることを確認する
- [x] 8.3 6つ以上のアカウントへ接続し、すべてが同時にサインイン状態を保つことを確認する（5セッション上限を受けない）
- [x] 8.4 `Cmd+Shift+A` からのアカウント切替が動作することを確認する
- [x] 8.5 認証情報の有効期限が切れたタブを操作し、無言で再接続され直前の画面に戻ることを確認する
- [x] 8.6 複数アカウントで合計40タブ開き、タブセクションに現在アカウントのタブのみが表示されることを確認する
- [x] 8.7 一覧の手動リフレッシュが動作することを確認する
