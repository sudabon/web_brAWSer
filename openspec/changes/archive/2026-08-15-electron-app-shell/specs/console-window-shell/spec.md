## ADDED Requirements

### Requirement: アプリケーションウィンドウ

システムは `BaseWindow` を用いて単一のアプリケーションウィンドウを生成しなければならない (SHALL)。非推奨 API である `BrowserView` を使用してはならない (MUST NOT)。

#### Scenario: 起動時のウィンドウ生成

- **WHEN** アプリが起動する
- **THEN** `titleBarStyle: 'hiddenInset'` のウィンドウが生成され、**左側にサイドパネル領域**が確保される

#### Scenario: ウィンドウのリサイズ

- **WHEN** 利用者がウィンドウをリサイズする
- **THEN** 表示中のタブの `WebContentsView` の bounds がサイドパネル領域を除いた領域に追従する

### Requirement: 左サイドパネルのレイアウト

システムはウィンドウ左側に単一のサイドパネルを配置し、その中を上から順にアカウントセクション、タブセクション、TOTP セクションに区切らなければならない (SHALL)。タブは水平タブバーではなく、このパネル内の**縦型リスト**として表示されなければならない (MUST)。

#### Scenario: パネル内のセクション構成

- **WHEN** サイドパネルが表示される
- **THEN** 上部にアカウントセクション、その下にタブセクション、最下部に TOTP セクションが縦に並ぶ

#### Scenario: コンテンツ領域の配置

- **WHEN** タブが表示される
- **THEN** `WebContentsView` の bounds は `x` にサイドパネル幅、`y` にタイトルバー高さを持ち、ウィンドウの残り領域全体を占める

#### Scenario: セクションの独立スクロール

- **WHEN** アカウントセクションの項目数がセクションの高さを超える
- **THEN** アカウントセクションのみがスクロールし、タブセクションと TOTP セクションは表示位置を保つ

### Requirement: サイドパネルの折りたたみ

システムはサイドパネルを折りたたんで、コンテンツ領域をウィンドウ全幅に広げられなければならない (SHALL)。

#### Scenario: パネルの折りたたみ

- **WHEN** 利用者がパネルの折りたたみを実行する
- **THEN** サイドパネルが非表示になり、表示中の `WebContentsView` の bounds が `x: 0` からウィンドウ全幅に更新される

#### Scenario: パネルの復帰

- **WHEN** 折りたたまれた状態で再度実行する
- **THEN** サイドパネルが元の幅で表示され、`WebContentsView` の bounds が元に戻る

#### Scenario: パネル幅の変更

- **WHEN** 利用者がサイドパネルの幅を変更する
- **THEN** 表示中の `WebContentsView` の bounds が新しい幅に追従する

### Requirement: タブとしての WebContentsView

システムはタブ1つにつき `WebContentsView` を1つ生成し、その生成・破棄・レイアウト・切替を担わなければならない (SHALL)。

#### Scenario: タブの生成

- **WHEN** パーティション名と URL を指定してタブの生成が要求される
- **THEN** 指定パーティションの `WebContentsView` が生成され、`contentView` に追加され、URL がロードされる

#### Scenario: タブの切替

- **WHEN** 表示中でないタブが選択される
- **THEN** 直前に表示していたビューが `removeChildView()` でデタッチされ、選択されたビューが表示される。デタッチされたビューは破棄されない

#### Scenario: タブのクローズ

- **WHEN** タブのクローズが要求される
- **THEN** 対応する `WebContentsView` がウィンドウから取り除かれ、その `webContents` が破棄される

### Requirement: パーティションによる Cookie 分離

システムは各タブに `persist:` プレフィックス付きのパーティション名を割り当てられなければならない (SHALL)。`persist:` のないパーティションはメモリ内セッションとなり再起動で Cookie が消えるため、永続が必要なタブに使用してはならない (MUST NOT)。

#### Scenario: 異なるパーティションの分離

- **WHEN** 異なるパーティションを指定した2つのタブが同一ドメインを開く
- **THEN** 各タブは互いに独立した Cookie ジャーを持ち、一方のサインイン状態が他方に影響しない

#### Scenario: 再起動後の Cookie 保持

- **WHEN** `persist:` プレフィックス付きパーティションでサインイン後にアプリを再起動する
- **THEN** 同じパーティションを指定したタブで Cookie が保持されている

### Requirement: セキュリティ既定値

すべての `WebContentsView` は `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true` で生成されなければならない (MUST)。アプリはプロセス起動時に `app.enableSandbox()` を呼び出さなければならない (MUST)。

#### Scenario: コンテンツビューの生成設定

- **WHEN** AWS コンテンツ用の `WebContentsView` が生成される
- **THEN** `contextIsolation` / `sandbox` / `webSecurity` が有効かつ `nodeIntegration` が無効であり、preload は指定された最小のスクリプトのみ

#### Scenario: アプリUIのCSP

- **WHEN** アプリ自身の UI レンダラがロードされる
- **THEN** Content-Security-Policy が設定されている

### Requirement: 開発者ツールへのアクセス

システムは AWS コンテンツとアプリ自身の UI の双方について DevTools を開けなければならない (SHALL)。

#### Scenario: コンテンツの DevTools

- **WHEN** 利用者が `Cmd+Opt+I` を押す
- **THEN** 表示中のタブの `webContents` に対して DevTools が `mode: 'right'` で開く

#### Scenario: アプリUIの DevTools

- **WHEN** 利用者が `Cmd+Opt+Shift+I` を押す
- **THEN** アプリ UI のレンダラに対して DevTools が開く
