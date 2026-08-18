## ADDED Requirements

### Requirement: カスタムスキームと open-url の受理

システムはカスタムスキーム `aws-console://` を登録し、`open-url` イベントを処理しなければならない (SHALL)。

#### Scenario: スキームの登録

- **WHEN** アプリが起動する
- **THEN** `aws-console://` が本アプリのスキームとして OS に登録される

#### Scenario: 起動済みアプリでの受理

- **WHEN** アプリが起動している状態で `aws-console://` URL が開かれる
- **THEN** `open-url` イベントが処理され、新規ウィンドウを増やさずに既存ウィンドウで開く

#### Scenario: 未起動時の受理

- **WHEN** アプリが起動していない状態で対象 URL が開かれる
- **THEN** アプリが起動し、起動完了後にその URL が処理される

### Requirement: URL からのアカウント判定

システムは受理した URL に含まれる `accountId` から対応するアカウント×ロールを判定し、そのパーティションのタブで開かなければならない (SHALL)。

#### Scenario: accountId を判定できる場合

- **WHEN** URL に既知のアカウントの `accountId` が含まれる
- **THEN** 該当アカウント×ロールの専用パーティションのタブで URL が開かれ、未接続であれば先に接続が実行される

#### Scenario: accountId を判定できない場合

- **WHEN** URL から `accountId` を判定できない
- **THEN** アカウント選択パレットが表示され、利用者が選んだアカウント×ロールで開かれる

#### Scenario: 未知の accountId

- **WHEN** URL に一覧に存在しない `accountId` が含まれる
- **THEN** アカウント選択パレットが表示される

#### Scenario: 許可外 URL

- **WHEN** 受理した URL が許可ドメインリストに含まれない
- **THEN** タブでは開かれず、既定ブラウザへ委譲される

### Requirement: 既定ブラウザからの委譲

システムは AWS 系 URL の既定ハンドラとして登録でき、Finicky などのブラウザセレクタから URL を受け取れなければならない (SHALL)。

#### Scenario: 既定ハンドラの登録

- **WHEN** 利用者がアプリを既定ハンドラとして登録する
- **THEN** OS に登録され、対象 URL が本アプリへ渡される

#### Scenario: Finicky 連携の文書化

- **WHEN** 利用者が連携手順を参照する
- **THEN** `console.aws.amazon.com` / `awsapps.com/start` / `signin.aws.amazon.com` を本アプリへ流す Finicky ルール例が提供されている
