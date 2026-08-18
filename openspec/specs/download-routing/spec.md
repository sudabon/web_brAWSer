# download-routing Specification

## Purpose
TBD - created by archiving change workspace-persistence-guardrails. Update Purpose after archive.
## Requirements
### Requirement: アカウント別ダウンロード振り分け

システムは `will-download` を捕捉し、ダウンロードファイルの保存先をアカウント別のディレクトリ `~/Downloads/AWS/<accountAlias>/` に自動設定しなければならない (SHALL)。

#### Scenario: 保存先の自動設定

- **WHEN** アカウント `prod-web` のタブからファイルがダウンロードされる
- **THEN** `~/Downloads/AWS/prod-web/<filename>` に保存され、保存先ダイアログは表示されない

#### Scenario: ディレクトリの自動作成

- **WHEN** 保存先ディレクトリが存在しない
- **THEN** ディレクトリが作成されてから保存される

#### Scenario: 同名ファイルの重複

- **WHEN** 同じ名前のファイルが既に保存先に存在する
- **THEN** 既存ファイルを上書きせず、一意な名前が付与されて保存される

#### Scenario: 対象ファイル種別

- **WHEN** 認証情報CSV、コストレポート、CloudFormation テンプレート、S3 オブジェクト、ログのエクスポートがダウンロードされる
- **THEN** いずれも同じ規則でアカウント別ディレクトリへ振り分けられる

### Requirement: ダウンロード完了の通知

システムはダウンロードの完了を利用者に通知しなければならない (SHALL)。

#### Scenario: 完了通知

- **WHEN** ダウンロードが正常に完了する
- **THEN** ファイル名と保存先を含む通知が表示される

#### Scenario: 失敗またはキャンセル

- **WHEN** ダウンロードが失敗またはキャンセルされる
- **THEN** その旨が通知され、完了として扱われない

