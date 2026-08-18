## Why

2つの理由でこの change は省略できない。

第一に**セキュリティ上の義務**である。本アプリは信頼できないコードを実行する装置（Chromium）を自作したものであり、Chromium の CVE 追従を自動化しないなら作らないほうがよい。`electron-updater` による自動更新は選択肢ではなく前提条件である。

第二に**日常運用の成立条件**である。未署名アプリは `safeStorage` の参照ごとに Keychain プロンプトを出し、TOTP とアカウント接続のたびに摩擦が生じる。また Slack やドキュメントから開かれた AWS の URL が既定ブラウザに流れてしまうと、「AWS作業を専用ウィンドウに隔離する」という本アプリの目的そのものが崩れる。

## What Changes

- `electron-builder` でアプリをパッケージし、コード署名（Apple Developer 証明書、なければ ad-hoc 署名）と公証を設定する
- `electron-updater` による自動更新を有効化し、Chromium のマイナー更新を定期的に取り込む
- カスタムスキーム `aws-console://` を登録し、`open-url` イベントを処理する
- URL に含まれる `accountId` から適切なパーティションのタブで開く。`accountId` が判定できない場合はアカウント選択パレットを表示する
- Finicky 連携用のルール例をドキュメント化し、`console.aws.amazon.com` / `awsapps.com/start` / `signin.aws.amazon.com` を本アプリへ流せるようにする
- アプリを既定のハンドラとして登録できるようにする

## Capabilities

### New Capabilities

- `app-distribution`: `electron-builder` によるパッケージング、コード署名と公証、`electron-updater` による自動更新と Chromium CVE 追従。
- `url-handoff`: カスタムスキーム `aws-console://` と `open-url` の受理、URL からのアカウント判定と適切なパーティションでのタブオープン、判定不能時のアカウント選択パレット提示、外部ブラウザ（Finicky）からの委譲。

### Modified Capabilities

なし

## Impact

| 対象 | 内容 |
|---|---|
| 新規ファイル | `electron-builder.yml`, `src/main/UrlHandoff.ts`, `docs/finicky-integration.md` |
| 新規依存 | `electron-updater` |
| 外部要件 | Apple Developer 証明書（署名・公証用）、更新フィードの配信先 |
| 前提 | `sso-account-directory` のアカウント切替パレットが存在すること |
| セキュリティ | 自動更新の無効化は許容しない。更新フィードは HTTPS 経由かつ署名検証必須 |
| 未確定 | Apple Developer 証明書が用意できない場合は ad-hoc 署名にフォールバックし、初回許可運用とする |
