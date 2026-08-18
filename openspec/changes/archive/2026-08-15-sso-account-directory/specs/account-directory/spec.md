## ADDED Requirements

### Requirement: アプリ内での SSO セッション確立

システムは device authorization の検証 URL をアプリ内の専用パーティション `persist:sso-portal` で開き、SSO セッションの確立をアプリ内で完結させなければならない (SHALL)。

#### Scenario: 初回のサインイン

- **WHEN** 有効な SSO `accessToken` を保持していない状態でアプリが起動する
- **THEN** `StartDeviceAuthorization` の `verificationUriComplete` が `persist:sso-portal` パーティションのビューで開かれ、Identity Center のサインイン画面が表示される

#### Scenario: 承認完了後のトークン取得

- **WHEN** 利用者が ID/パスワード、MFA、「Allow」を完了する
- **THEN** ポーリング中の `CreateToken` が成功し、SSO セッションが確立してサイドバーが利用可能になる

### Requirement: SSO 状態の永続化

システムは SSO のクライアント登録情報とトークンを `safeStorage` で暗号化して `sso.enc` に保存し、起動時に復元しなければならない (SHALL)。

#### Scenario: 起動時の復元

- **WHEN** 有効期限内の `accessToken` を含む `sso.enc` が存在する状態でアプリが起動する
- **THEN** device authorization を実行せずに SSO セッションが復元され、MFA 入力を求められない

#### Scenario: refreshToken による更新

- **WHEN** `accessToken` が失効しており `refreshToken` が保存されている
- **THEN** 先に `refreshToken` による更新を試み、失敗した場合にのみ device authorization をやり直す

#### Scenario: クライアント登録の失効

- **WHEN** 保存された `clientId` / `clientSecret` が有効期限（約90日）を過ぎている
- **THEN** `RegisterClient` を再実行してから device authorization を開始する

### Requirement: アカウント×ロール一覧の取得とキャッシュ

システムは `ListAccounts` と `ListAccountRoles` の結果をキャッシュし、サイドバーに `accountId × roleName` のツリーとして表示しなければならない (SHALL)。この一覧はタブを消費してはならない (MUST NOT)。

#### Scenario: 一覧の初回取得

- **WHEN** SSO セッションが確立する
- **THEN** 全アカウントとそのロールが取得され、サイドバーにツリーとして表示され、結果がキャッシュされる

#### Scenario: キャッシュからの表示

- **WHEN** キャッシュが存在する状態でアプリが起動する
- **THEN** API 呼び出しを待たずにキャッシュ内容でサイドバーが即座に描画される

#### Scenario: 手動リフレッシュ

- **WHEN** 利用者がサイドバーのリフレッシュを実行する
- **THEN** `ListAccounts` / `ListAccountRoles` が再実行され、キャッシュとサイドバーが更新される

### Requirement: アカウント単位のユーザー設定

システムはアカウントごとに色、タグ（`prod` / `stg` / `dev` / `sandbox`）、既定リージョンを設定でき、`config.json` に永続化しなければならない (SHALL)。

#### Scenario: 設定の編集と保存

- **WHEN** 利用者がアカウントの色・タグ・既定リージョンを変更する
- **THEN** 変更が `config.json` に保存され、再起動後も保持される

#### Scenario: 既定値の適用

- **WHEN** 未設定のアカウントが一覧に現れる
- **THEN** 既定リージョン `ap-northeast-1` と自動割当の色が適用され、タグは未設定となる

### Requirement: アカウント切替パレット

システムは fuzzy 検索付きのアカウント切替パレットを提供しなければならない (SHALL)。

#### Scenario: パレットの起動と絞り込み

- **WHEN** 利用者が `Cmd+Shift+A` を押して文字列を入力する
- **THEN** アカウント名・アカウントID・ロール名に対する fuzzy 検索で候補が絞り込まれる

#### Scenario: パレットからの選択

- **WHEN** 利用者が候補を選択して確定する
- **THEN** そのアカウント×ロールが選択状態となり、未接続であれば接続が開始される

### Requirement: 二層モデルによるタブ表示

左サイドパネルのタブセクションには、現在選択中のアカウント×ロールに属するタブのみが表示されなければならない (MUST)。

#### Scenario: アカウント切替時のタブ表示

- **WHEN** 複数アカウントで合計40タブを開いた状態でアカウントを切り替える
- **THEN** タブセクションには切替先アカウントに属するタブのみが表示され、他アカウントのタブは表示されない

#### Scenario: パネル内での二層の配置

- **WHEN** サイドパネルが表示される
- **THEN** 上部のアカウントセクションに全アカウント×ロールのツリーが、その下のタブセクションに現在選択中のアカウントのタブのみが表示される

#### Scenario: アカウントセクションはタブを消費しない

- **WHEN** 40アカウントが一覧に存在する
- **THEN** アカウントセクションにはすべてが表示されるが、タブは1つも生成されない
