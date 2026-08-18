# navigation-guard Specification

## Purpose
TBD - created by archiving change electron-app-shell. Update Purpose after archive.
## Requirements
### Requirement: 許可ドメインの判定

システムはナビゲーション先 URL のホスト名を許可リストと照合し、許可対象かどうかを判定しなければならない (SHALL)。許可リストは次を含む: `signin.aws.amazon.com`、`*.signin.aws`、`*.console.aws.amazon.com`、`*.awsapps.com`、`*.amazonaws.com`、`*.aws.amazon.com`、`*.awsstatic.com`、`*.cloudfront.net`、`docs.aws.amazon.com`、`health.aws.amazon.com`。

#### Scenario: 許可ドメインの判定

- **WHEN** `https://ap-northeast-1.console.aws.amazon.com/ec2/home` を判定する
- **THEN** 許可対象と判定される

#### Scenario: Identity Center の signin.aws ホスト

- **WHEN** `https://ap-northeast-1.signin.aws/platform/d-example/login` を判定する
- **THEN** 許可対象と判定される

#### Scenario: 非許可ドメインの判定

- **WHEN** `https://github.com/example/repo` を判定する
- **THEN** 非許可と判定される

#### Scenario: 不正なURLの判定

- **WHEN** URL としてパースできない文字列を判定する
- **THEN** 例外を送出せず、非許可と判定される

### Requirement: ナビゲーションの制御

システムは `will-navigate` を捕捉し、許可外のナビゲーションを中止して既定ブラウザへ委譲しなければならない (SHALL)。

#### Scenario: 許可内へのナビゲーション

- **WHEN** タブ内のリンクから許可ドメインへ遷移しようとする
- **THEN** そのままタブ内で遷移する

#### Scenario: 許可外へのナビゲーション

- **WHEN** タブ内のリンクから許可外ドメインへ遷移しようとする
- **THEN** ナビゲーションが `preventDefault()` で中止され、`shell.openExternal()` により既定ブラウザで開かれる

### Requirement: window.open のハンドリング

システムは `setWindowOpenHandler` により `window.open` を捕捉しなければならない (SHALL)。許可内の URL は**呼び出し元と同一のパーティション**の新規タブとして開かなければならない (MUST)。別パーティションで開くとコンソールセッションが切断されるためである。

#### Scenario: 許可内の window.open

- **WHEN** AWS コンソールが許可ドメインの URL に対して `window.open` を呼ぶ
- **THEN** 呼び出し元と同一パーティションで新規タブが開かれ、ハンドラは `{ action: 'deny' }` を返して Electron 既定のウィンドウ生成を抑止する

#### Scenario: 許可外の window.open

- **WHEN** AWS コンソールが許可外ドメインの URL に対して `window.open` を呼ぶ
- **THEN** `shell.openExternal()` で既定ブラウザに委譲され、ハンドラは `{ action: 'deny' }` を返す

#### Scenario: CloudShell やドキュメントの別ウィンドウ

- **WHEN** コンソールから CloudShell やサービス別ドキュメントが `window.open` で開かれる
- **THEN** 同一パーティションのタブで開かれ、サインイン状態が維持される

