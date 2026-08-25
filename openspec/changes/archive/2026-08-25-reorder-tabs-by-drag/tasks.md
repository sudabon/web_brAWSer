## 1. IPC 経路の定義

- [x] 1.1 `src/shared/types.ts` の `IPC` に `tabsReorder: "tabs:reorder"` を追加する
- [x] 1.2 `src/preload/preload-ui.ts` の `tabs` に `reorder(id: string, toIndex: number): Promise<void>` を追加する
- [x] 1.3 `src/renderer/env.d.ts` の `window.brawser.tabs` 型に `reorder` を追加し、`pnpm typecheck:web` と `pnpm typecheck:node` が通ることを確認する

## 2. TabManager の並べ替え API（TDD）

- [x] 2.1 `src/main/TabManager.test.ts` に失敗するテストを追加する: 下方向の移動が期待どおりの配列順になる
- [x] 2.2 同テストに上方向の移動、同一位置へのドロップ（順序不変）のケースを追加する
- [x] 2.3 同テストに境界ケースを追加する: 未知の ID は no-op、`toIndex` が範囲外の場合は先頭／末尾へクランプされる
- [x] 2.4 同テストに副作用の確認を追加する: 並べ替え後に `persistTabs` と `onChange` が呼ばれる／アクティブタブとハイバネート状態が変化しない
- [x] 2.5 `TabManager.reorderTab(id, toIndex)` を実装し、2.1〜2.4 のテストを通す（`renameTab` と同じく `#persist()` → `options.onChange()` の順で呼ぶ）

## 3. 主プロセスの IPC ハンドラ

- [x] 3.1 `src/main/main.ts` の `registerIpc` の `handlers` 配列に `IPC.tabsReorder` を追加する
- [x] 3.2 `ipcMain.handle(IPC.tabsReorder, ...)` を追加し、`id` が string・`toIndex` が有限の整数であることを検証してから `tabManager.reorderTab` を呼ぶ

## 4. サイドパネルの D&D 実装

- [x] 4.1 `TabListItem` にドラッグ用の props（インデックス、ドラッグ開始／ホバー／ドロップのコールバック、ドロップ位置の表示状態）を追加する
- [x] 4.2 `<li>` に `draggable` を付け、タブ名編集中は `draggable={false}` にする
- [x] 4.3 `dragstart` でドラッグ元インデックスを保持し、`dragover` で対象行の矩形中央線から挿入位置（前／後）を判定する
- [x] 4.4 `drop` で最終インデックスを算出して `window.brawser.tabs.reorder` を呼び、`dragend` / `dragleave` で挿入位置の表示を解除する
- [x] 4.5 ドラッグ中フラグを用いて、ドラッグ由来の `click` でタブ選択が発火しないようにする

## 5. スタイル

- [x] 5.1 `src/renderer/side-panel.css` に `.tab-item.dragging`（掴んでいる行の半透明表示）を追加する
- [x] 5.2 挿入位置インジケータ `.drop-before` / `.drop-after` を追加し、既存の `.tab-item` / `.tab-item.active` の見た目と衝突しないことを確認する

## 6. 検証

- [x] 6.1 `pnpm test` を実行し、全テストが通ることを確認する
- [x] 6.2 `pnpm typecheck:node` と `pnpm typecheck:web` を実行して型エラーがないことを確認する
- [x] 6.3 `pnpm dev` で起動し、実機で確認する: 上下方向の並べ替え、アカウントを跨ぐ並べ替え、リスト外へのドロップで順序が変わらないこと、ドラッグでタブが選択されないこと、ダブルクリックのリネームが従来どおり動くこと
- [x] 6.4 並べ替え後にアプリを再起動し、`tabs.json` の配列順と表示順が並べ替え結果と一致することを確認する
- [x] 6.5 並べ替え後の `Cmd+1`〜`Cmd+9` と `Cmd+Shift+[` / `]` が新しい表示順に追従することを確認する
