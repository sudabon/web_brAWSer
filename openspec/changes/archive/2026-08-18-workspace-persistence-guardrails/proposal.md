## Why

ここまでの change でアプリは動作するが、常用には耐えない。再起動でタブが消え、40タブ開けばメモリを食い潰し、「今どのアカウントを見ているか」が視覚的に弱いままで prod 誤操作のリスクが残る。

マルチアカウント運用において**実用上もっとも効くのはガードレール**であり、アカウント色の常時可視化はその中核になる。あわせて、タブ状態の永続化・ハイバネート・ダウンロードの振り分け・ショートカット体系を入れて日常運用の摩擦を落とす。

## What Changes

- `tabs.json` にタブツリーを永続化し、起動時は**全タブをハイバネート状態で復元**する（起動が速い）
- 非アクティブが30分（設定可）を超えたタブは `webContents` を破棄し、URL / タイトル / favicon のみ保持する。再選択時に再ナビゲートする。**コンソールセッションは Cookie 側にあるため、復元は単なる再読込で済む**
- アカウントあたり推奨10タブを超えたら、古い順に自動ハイバネートする
- アカウントごとに設定した色を、preload から `document.documentElement` の**上端6pxバー**として注入する。左サイドパネルとウィンドウのタイトルバーも同色にする
- `prod` タグのアカウントはタブに警告アイコンを表示する
- `will-download` をハンドリングし、`~/Downloads/AWS/<accountAlias>/` へアカウント別に自動振り分けする。完了を通知する
- キーボードショートカット体系を実装する（`Cmd+K` コマンドパレット、`Cmd+T`/`Cmd+W`、`Cmd+1`〜`Cmd+9`、`Cmd+Shift+[`/`]`、`Cmd+Opt+R` リージョン切替、`Cmd+R`、`Cmd+F` ページ内検索）
- `config.json`（アカウント設定・色・タグ・既定リージョン、平文可）の読み書きを確定する

## Capabilities

### New Capabilities

- `tab-persistence`: タブツリーの永続化と起動時のハイバネート復元、非アクティブタブの自動ハイバネートと再選択時の復元、アカウントあたりのタブ数上限の適用。
- `account-guardrails`: アカウント色の上端バー注入、左サイドパネル・タイトルバーへの色反映、`prod` タグ付きアカウントの警告表示。
- `download-routing`: ダウンロードのアカウント別ディレクトリ振り分けと完了通知。
- `keyboard-shortcuts`: コマンドパレットを含むアプリ全体のキーボードショートカット体系とページ内検索。

### Modified Capabilities

なし

## Impact

| 対象 | 内容 |
|---|---|
| 新規ファイル | `src/main/PersistenceStore.ts`, `src/main/DownloadManager.ts`, `src/main/ShortcutRegistry.ts`, `src/renderer/CommandPalette.tsx` |
| 既存への影響 | `TabManager` にハイバネート状態とライフサイクルが加わる。`preload-aws.ts` に色バー注入の責務が加わる（preload の責務はこの2つ＋MFA入力補助に限定し、これ以上増やさない） |
| データ | `~/Library/Application Support/aws-console-browser/` 配下に `config.json`, `tabs.json` を平文で置く |
| 前提 | `sso-account-directory` のアカウント設定（色・タグ）が存在すること |
| 非目標 | メモリ使用量の削減そのもの。ハイバネートは常用時の実用性のためであり、AWSコンソールは重量級SPAなので「軽量化」は本アプリの目標ではない |
