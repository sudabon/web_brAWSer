# app-distribution Specification

## Purpose
TBD - created by archiving change packaging-and-url-handoff. Update Purpose after archive.
## Requirements
### Requirement: アプリケーションのパッケージング

システムは `electron-builder` により macOS 向けの配布可能なアプリケーションをビルドできなければならない (SHALL)。Apple Silicon と Intel の双方を対象としなければならない (SHALL)。

#### Scenario: ビルドの実行

- **WHEN** パッケージングコマンドを実行する
- **THEN** 署名済みの `.app` および配布用イメージが生成される

#### Scenario: アーキテクチャ

- **WHEN** ビルド成果物を検査する
- **THEN** Apple Silicon と Intel の双方で起動できる形式になっている

### Requirement: コード署名

システムはビルド成果物にコード署名を行わなければならない (SHALL)。Apple Developer 証明書が利用可能な場合は署名と公証を行い、利用できない場合は ad-hoc 署名にフォールバックしなければならない (SHALL)。

#### Scenario: 証明書がある場合

- **WHEN** Apple Developer 証明書が設定されている
- **THEN** 成果物が署名され、公証（notarization）が実行される

#### Scenario: 証明書がない場合

- **WHEN** Apple Developer 証明書が設定されていない
- **THEN** ad-hoc 署名でビルドが完了し、Keychain プロンプトが起動のたびに出る可能性がある旨が文書化されている

#### Scenario: 署名と safeStorage

- **WHEN** 署名済みアプリが起動して `safeStorage` を参照する
- **THEN** Keychain のプロンプトは起動のたびには出ない

### Requirement: 自動更新による Chromium CVE 追従

システムは `electron-updater` による自動更新を有効にしなければならない (MUST)。自動更新を無効化した構成を配布してはならない (MUST NOT)。

#### Scenario: 更新の検出と適用

- **WHEN** 新しいバージョンが更新フィードに存在する状態でアプリが起動する
- **THEN** 更新が検出され、ダウンロードされ、次回起動時に適用される

#### Scenario: 更新の検証

- **WHEN** 更新パッケージがダウンロードされる
- **THEN** 署名が検証され、検証に失敗した更新は適用されない

#### Scenario: フィードの通信路

- **WHEN** 更新フィードへ問い合わせる
- **THEN** 通信は HTTPS で行われる

#### Scenario: 更新失敗時の動作

- **WHEN** 更新の取得に失敗する
- **THEN** 現行バージョンでの動作が継続され、失敗が記録される

