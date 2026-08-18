# tab-persistence Specification

## Purpose
TBD - created by archiving change workspace-persistence-guardrails. Update Purpose after archive.
## Requirements
### Requirement: タブ状態の永続化

システムはタブツリー（ID、所属アカウント×ロール、URL、タイトル、最終アクティブ時刻）を `tabs.json` に保存しなければならない (SHALL)。

#### Scenario: タブ変更時の保存

- **WHEN** タブが追加・削除・ナビゲートされる
- **THEN** `tabs.json` の内容が更新される

#### Scenario: 認証情報の非保存

- **WHEN** `tabs.json` を検査する
- **THEN** 一時認証情報および SigninToken を含む URL は保存されていない

### Requirement: 起動時のハイバネート復元

システムは起動時に、保存されたすべてのタブを**ハイバネート状態**で復元しなければならない (SHALL)。起動時に `webContents` を生成してはならない (MUST NOT)。

#### Scenario: 復元後の表示

- **WHEN** 30タブが保存された状態でアプリが起動する
- **THEN** サイドパネルのタブセクションには URL・タイトル・favicon を持つ30タブが表示されるが、`webContents` はいずれも生成されていない

#### Scenario: 復元タブの選択

- **WHEN** 利用者が復元されたハイバネート状態のタブを選択する
- **THEN** `webContents` が生成され、保存された URL へナビゲートされる

### Requirement: 非アクティブタブの自動ハイバネート

システムは設定された時間（既定30分）を超えて非アクティブなタブの `webContents` を破棄し、URL / タイトル / favicon のみを保持しなければならない (SHALL)。

#### Scenario: 時間経過によるハイバネート

- **WHEN** タブが30分間アクティブにならない
- **THEN** その `webContents` が破棄され、タブはハイバネート状態としてタブセクションに残る

#### Scenario: 再選択時の復元

- **WHEN** ハイバネートされたタブが再選択される
- **THEN** 同一パーティションで `webContents` が再生成され、保存 URL へ再ナビゲートされる。コンソールセッションは Cookie 側に残っているため再サインインは発生しない

#### Scenario: しきい値の変更

- **WHEN** 利用者がハイバネートまでの時間を変更する
- **THEN** 新しい値が保存され、以降のハイバネート判定に適用される

### Requirement: アカウントあたりのタブ数上限

システムはアカウントあたりのタブ数が上限（推奨10）を超えた場合、最終アクティブ時刻の古い順に自動ハイバネートしなければならない (SHALL)。

#### Scenario: 上限超過

- **WHEN** 1アカウントで11個目のタブが開かれる
- **THEN** 最も古くアクティブだったタブがハイバネートされる

#### Scenario: タブは閉じない

- **WHEN** 上限超過によるハイバネートが発生する
- **THEN** タブ自体は閉じられず、タブセクションに残り再選択可能である

