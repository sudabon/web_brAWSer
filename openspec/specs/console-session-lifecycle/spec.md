# console-session-lifecycle Specification

## Purpose
TBD - created by archiving change sso-account-directory. Update Purpose after archive.
## Requirements
### Requirement: アカウント×ロールごとの専用パーティション

システムは各アカウント×ロールに `persist:acct-<accountId>-<roleName>` 形式の専用パーティションを割り当てなければならない (SHALL)。異なるアカウント×ロールが同一パーティションを共有してはならない (MUST NOT)。

#### Scenario: パーティションの割当

- **WHEN** アカウント `123456789012` のロール `AdministratorAccess` に接続する
- **THEN** そのタブは `persist:acct-123456789012-AdministratorAccess` パーティションで生成される

#### Scenario: 多数アカウントの同時サインイン

- **WHEN** 6つ以上のアカウントへ接続する
- **THEN** すべてのアカウントが同時にサインイン状態を保ち、AWS 純正マルチセッションの5セッション上限の影響を受けない

### Requirement: ワンクリックでのコンソール接続

システムはサイドバーまたはパレットからの選択1回で、追加のログイン操作なしにコンソールへ接続しなければならない (SHALL)。

#### Scenario: 未接続アカウントへの接続

- **WHEN** 未接続のアカウント×ロールが選択される
- **THEN** `GetRoleCredentials` → `getSigninToken` → ログインURL生成 → 専用パーティションのタブでナビゲート、が自動実行され、最初のタブが既定リージョンのコンソールホームで開く

#### Scenario: 接続済みアカウントの選択

- **WHEN** 既に接続済みのアカウント×ロールが選択される
- **THEN** 再認証を行わず、そのアカウントの既存タブが表示される

### Requirement: サインインURLの即時使用

生成したログインURLは15分間のみ有効かつ実質ワンショットであるため、生成後ただちにナビゲートに用い、保存・キャッシュ・再利用をしてはならない (MUST NOT)。

#### Scenario: 生成から使用まで

- **WHEN** ログインURLが生成される
- **THEN** 直後に対象ビューへナビゲートされ、URL はどのファイルにも保存されない

#### Scenario: SigninToken の破棄

- **WHEN** ナビゲーションが開始される
- **THEN** メモリ上の `SigninToken` は破棄され、以降参照されない

### Requirement: 認証情報の有効期限追跡

システムは各アカウント×ロールの `GetRoleCredentials` の `expiration` を保持し、サイドバーに残り時間を表示しなければならない (SHALL)。

#### Scenario: 残り時間の表示

- **WHEN** 接続中のアカウントの認証情報が有効期限内である
- **THEN** サイドバーに期限時刻または残り時間が表示される

#### Scenario: 期限接近の警告表示

- **WHEN** 残り時間が10分を切る
- **THEN** 該当アカウントの表示が黄色になる

#### Scenario: 期限切れの表示

- **WHEN** 認証情報の有効期限を過ぎる
- **THEN** 該当アカウントの表示が灰色になる

### Requirement: 期限切れ時の無言再接続

システムは期限切れタブが操作されたとき、SSO `accessToken` が有効であれば利用者に操作を求めることなく federation を再実行し、直前の URL へ復帰させなければならない (SHALL)。

#### Scenario: SSO トークンが有効な場合の再接続

- **WHEN** 認証情報が失効したタブを利用者が操作する
- **THEN** `GetRoleCredentials` からログインURL生成までが再実行され、`Destination` に直前の URL を指定してナビゲートされる。利用者には一度のリロードとしてのみ見える

#### Scenario: SSO トークンも失効している場合

- **WHEN** SSO `accessToken` 自体が失効している
- **THEN** `refreshToken` による更新を試み、失敗した場合は device authorization をやり直す（MFA 入力1回）

### Requirement: 一時認証情報の非公開

一時認証情報（`accessKeyId` / `secretAccessKey` / `sessionToken`）はメインプロセスのメモリ上にのみ保持しなければならない (MUST)。レンダラプロセスへ渡してはならず、ディスクへ書き込んでもならず、ログへ出力してもならない (MUST NOT)。

#### Scenario: レンダラへの非伝搬

- **WHEN** サイドバーが接続状態を表示する
- **THEN** IPC で渡されるのは接続状態と有効期限のみであり、認証情報そのものは含まれない

#### Scenario: 永続化対象からの除外

- **WHEN** アプリが状態を永続化する
- **THEN** `config.json` / `tabs.json` / `sso.enc` のいずれにも一時認証情報は含まれない

