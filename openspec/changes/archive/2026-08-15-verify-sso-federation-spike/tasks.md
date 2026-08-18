## 1. プロジェクト基盤

- [x] 1.1 `package.json` を作成し、`type: "module"` と実行スクリプト（`tsx spike/federation-spike.ts`）を定義する
- [x] 1.2 `tsconfig.json` を作成する（target ES2022、strict、moduleResolution bundler）
- [x] 1.3 依存を追加する: `@aws-sdk/client-sso-oidc`, `@aws-sdk/client-sso`, `typescript`, `tsx`
- [x] 1.4 `.gitignore` に `node_modules/` と `spike/*.local.*` を追加する
- [x] 1.5 `startUrl` と `region` を環境変数（`SSO_START_URL` / `SSO_REGION`）から読み、未設定なら明確なエラーで終了する仕組みを入れる

## 2. federation コアモジュール（Electron 非依存）

- [x] 2.1 `spike/federation.ts` を作成し、以降の関数をすべてここに置く（Electron・ファイルI/O・グローバル状態に依存させない）
- [x] 2.2 `registerClient(region)` を実装する — `RegisterClient` を `clientType: 'public'` で呼び、`clientId` / `clientSecret` / 有効期限を返す
- [x] 2.3 `startDeviceAuthorization(region, client, startUrl)` を実装する — `deviceCode` / `userCode` / `verificationUriComplete` / `interval` を返す
- [x] 2.4 `pollForToken(region, client, deviceCode, interval)` を実装する — `AuthorizationPendingException` のみリトライし、他の例外は再送出する
- [x] 2.5 `listAccountsWithRoles(region, accessToken)` を実装する — `ListAccounts` と各アカウントの `ListAccountRoles` を呼び、アカウント×ロールの配列を返す
- [x] 2.6 `getRoleCredentials(region, accessToken, accountId, roleName)` を実装する
- [x] 2.7 `getSigninToken(credentials)` を実装する — `signin.aws.amazon.com/federation?Action=getSigninToken` へ **POST** で送信する
- [x] 2.8 `buildLoginUrl(signinToken, destination, issuer)` を実装する — `Action=login` / `Issuer` / `Destination` / `SigninToken` を組み立てる
- [x] 2.9 全関数で秘密情報（`clientSecret` / 一時認証情報 / `SigninToken`）をログ出力しないことをコードレビューで確認する

## 3. スパイク実行スクリプト

- [x] 3.1 `spike/federation-spike.ts` を作成し、2 の関数を順に呼ぶ実行フローを書く
- [x] 3.2 `verificationUriComplete` を標準出力に表示し、利用者にブラウザでの承認を促す
- [x] 3.3 アカウント一覧を `console.table` で表示する（`accountId` / `accountName` / ロール数のみ。認証情報は含めない）
- [x] 3.4 対話的にアカウント×ロールを選べるようにする（最低2つ試せること）
- [x] 3.5 生成したログインURLを標準出力に表示する（**ファイルには書かない**）
- [x] 3.6 `SessionDuration=43200` を付与するモードをフラグで切り替えられるようにする

## 4. 検証（実 AWS 環境・人手）

- [x] 4.1 device auth が Identity Center の設定で許可されているかを確認する
- [x] 4.2 スパイクを実行し、生成したURLでコンソールに入れることを確認する
- [x] 4.3 **2つのアカウントのログインURLを、Chromeの別プロファイル（別Cookieジャー）で同時に開けることを確認する** — 設計全体の前提
- [x] 4.4 `SessionDuration=43200` を付けた場合にエラーになるかを確認する
- [x] 4.5 コンソールセッションが実際に何時間持つかを実測する（接続時刻を記録し、切れた時刻を確認）
- [x] 4.6 Identity Center が FIDO2 必須設定になっていないかを確認する
- [x] 4.7 CloudShell が Chromium 上で動作するかを確認する
- [x] 4.8 スパイク実行後、リポジトリと一時ディレクトリに秘密情報が残っていないことを確認する

## 5. 検証レポートと判断

- [x] 5.1 `spike/RESULTS.md` を作成し、4 の各項目の結果と実測値を記録する
- [x] 5.2 ロール側の max session duration の現行値と、引き上げ可否を記録する
- [x] 5.3 4.2 または 4.3 が失敗した場合、中止理由と純正マルチセッションへのフォールバック検討結果を記録する
- [x] 5.4 継続判断（GO / NO-GO）を `RESULTS.md` に明記し、GO の場合のみ `electron-app-shell` に着手する
