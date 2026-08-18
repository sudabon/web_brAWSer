# sso-federation-signin Specification

## Purpose
TBD - created by archiving change verify-sso-federation-spike. Update Purpose after archive.
## Requirements
### Requirement: SSO クライアント登録

システムは IAM Identity Center に対し、`clientType='public'` の OIDC クライアントとして自身を登録し、得られた `clientId` / `clientSecret` を後続の device authorization で再利用できなければならない (SHALL)。

#### Scenario: 初回のクライアント登録

- **WHEN** 有効な `clientId` を保持していない状態でスパイクを実行する
- **THEN** `sso-oidc:RegisterClient` を呼び出し、`clientId`、`clientSecret`、および有効期限（約90日）を取得する

#### Scenario: 登録失敗

- **WHEN** `RegisterClient` がエラーを返す
- **THEN** エラー内容を表示して処理を中断し、`clientSecret` をログに出力しない

### Requirement: デバイス認可によるアクセストークン取得

システムは device authorization grant によって SSO の `accessToken` を取得しなければならない (SHALL)。ユーザーによる MFA 入力を要求するのはこのフローの一度だけでなければならない (MUST)。

#### Scenario: 認可の開始

- **WHEN** `clientId` / `clientSecret` / ポータルの `startUrl` を用いて `StartDeviceAuthorization` を呼び出す
- **THEN** `deviceCode`、`userCode`、`verificationUriComplete`、ポーリング `interval` を取得し、`verificationUriComplete` を利用者に提示する

#### Scenario: 承認待ちのポーリング

- **WHEN** 利用者がまだブラウザ上で承認を完了していない
- **THEN** `CreateToken` が `AuthorizationPendingException` を返すため、`interval` 秒待って再試行し、それ以外の例外は再送出する

#### Scenario: トークン取得の成功

- **WHEN** 利用者がサインインと MFA と「Allow」を完了する
- **THEN** `CreateToken` が `accessToken`（既定8時間、Identity Center のセッション設定に依存）を返し、`refreshToken` が発行される設定であればそれも返す

### Requirement: アカウントとロールの列挙

システムは取得した `accessToken` を用いて、利用可能なアカウントとそのロールを列挙しなければならない (SHALL)。

#### Scenario: アカウント一覧の取得

- **WHEN** `sso:ListAccounts` を `accessToken` 付きで呼び出す
- **THEN** `accountId` と `accountName` の一覧を取得する

#### Scenario: ロール一覧の取得

- **WHEN** 特定の `accountId` について `sso:ListAccountRoles` を呼び出す
- **THEN** そのアカウントで引受可能な `roleName` の一覧を取得する

### Requirement: ロール一時認証情報の取得

システムは `accountId` と `roleName` の組に対して一時認証情報を取得しなければならない (SHALL)。取得した認証情報はプロセスのメモリ上にのみ保持し、ディスク・ログ・標準出力のいずれにも出力してはならない (MUST NOT)。

#### Scenario: 認証情報の取得

- **WHEN** `sso:GetRoleCredentials` を `accessToken` / `accountId` / `roleName` で呼び出す
- **THEN** `accessKeyId`、`secretAccessKey`、`sessionToken`、`expiration` を取得する

#### Scenario: 認証情報の非出力

- **WHEN** スパイクが実行を完了する
- **THEN** `accessKeyId` / `secretAccessKey` / `sessionToken` はいずれのファイルにも書き込まれておらず、コンソール出力にも現れない

### Requirement: フェデレーションサインインURLの生成

システムは一時認証情報から AWS マネジメントコンソールへのサインインURLを生成しなければならない (SHALL)。生成した URL は15分間のみ有効かつ実質ワンショットであるため、保存や再利用をしてはならない (MUST NOT)。

#### Scenario: SigninToken の取得

- **WHEN** `sessionId` / `sessionKey` / `sessionToken` を含む JSON を `Session` パラメータとして `https://signin.aws.amazon.com/federation?Action=getSigninToken` へ送信する
- **THEN** レスポンスから `SigninToken` を取得する

#### Scenario: ログインURLの組み立て

- **WHEN** `SigninToken` が得られている
- **THEN** `Action=login`、`Issuer`、`Destination`（既定 `https://ap-northeast-1.console.aws.amazon.com/console/home?region=ap-northeast-1`）、`SigninToken` を含む URL を組み立てる

#### Scenario: URL の使い捨て

- **WHEN** ログインURLを生成する
- **THEN** その URL をファイルやキャッシュに保存せず、即座に開く用途にのみ用いる

### Requirement: Electron 非依存のモジュール分離

federation フローの実装は Electron API に依存せず、後続マイルストーンからそのまま呼び出せる関数群として提供されなければならない (SHALL)。

#### Scenario: 素の Node.js での実行

- **WHEN** Electron を起動せずに Node.js ランタイムでスパイクを実行する
- **THEN** クライアント登録からログインURL生成まで一連の処理が完了する

### Requirement: 検証結果の記録

スパイクの実行結果として、後続マイルストーンの前提となる実測値が文書に記録されなければならない (SHALL)。

#### Scenario: 検証レポートの生成

- **WHEN** スパイクの検証作業が完了する
- **THEN** 次の各項目の結果が `spike/RESULTS.md` に記録される: device auth が Identity Center 設定で許可されているか / 生成URLでコンソールに入れるか / 2アカウントを別Cookieジャーで同時に開けるか / `SessionDuration=43200` を付けた場合にエラーになるか / コンソールセッションの実測持続時間 / Identity Center が FIDO2 必須設定になっていないか / CloudShell が Chromium 上で動作するか

#### Scenario: 継続判断のゲート

- **WHEN** 「生成URLでコンソールに入れる」または「2アカウントを別Cookieジャーで同時に開ける」のいずれかが失敗する
- **THEN** レポートに中止理由を記録し、後続の change に着手しない

