# account-guardrails Specification

## Purpose
TBD - created by archiving change workspace-persistence-guardrails. Update Purpose after archive.
## Requirements
### Requirement: アカウント色バーの注入

システムは preload から、表示中コンテンツの `document.documentElement` 上端に高さ6pxのアカウント色バーを注入しなければならない (SHALL)。

#### Scenario: 色バーの表示

- **WHEN** アカウント色が設定されたアカウントのタブが表示される
- **THEN** ページ最上端に該当色の6pxバーが表示される

#### Scenario: ページ遷移後の維持

- **WHEN** タブ内でコンソールのサービス間遷移が発生する
- **THEN** 遷移後のページにも色バーが再注入される

#### Scenario: 色設定の変更

- **WHEN** 利用者がアカウントの色を変更する
- **THEN** そのアカウントの表示中タブの色バーが新しい色に更新される

### Requirement: アプリクロームへの色反映

システムは左サイドパネルおよびウィンドウのタイトルバーに、現在選択中のアカウントの色を反映しなければならない (SHALL)。

#### Scenario: サイドパネルの色

- **WHEN** アカウントが選択されている
- **THEN** サイドパネルの左端に該当アカウント色のアクセントが表示される

#### Scenario: アカウント切替時の追従

- **WHEN** 別のアカウントへ切り替える
- **THEN** サイドパネルとタイトルバーの色が切替先アカウントの色に変わる

### Requirement: prod アカウントの警告表示

システムは `prod` タグが設定されたアカウントについて、タブに警告アイコンを表示しなければならない (SHALL)。

#### Scenario: 警告アイコンの表示

- **WHEN** `prod` タグ付きアカウントのタブが表示される
- **THEN** タブに警告アイコンが表示される

#### Scenario: 非 prod アカウント

- **WHEN** `stg` / `dev` / `sandbox` タグまたはタグ未設定のアカウントのタブが表示される
- **THEN** 警告アイコンは表示されない

### Requirement: 現在アカウントの常時可視性

利用者が AWS コンテンツを操作している間、現在のアカウントを示す視覚的手がかりが常に視界に入らなければならない (MUST)。

#### Scenario: 全画面操作時

- **WHEN** 利用者がコンソール上でスクロールや操作を行う
- **THEN** 上端の色バーとサイドパネルの色は隠れずに表示され続ける

#### Scenario: サイドパネル折りたたみ時

- **WHEN** 利用者がサイドパネルを折りたたんでコンテンツを全幅表示する
- **THEN** コンテンツ側の上端6px色バーは表示され続け、現在のアカウントが判別できる

