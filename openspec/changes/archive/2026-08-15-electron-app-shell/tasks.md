## 1. Electron プロジェクト基盤

- [x] 1.1 依存を追加する: `electron`, `vite`, `react`, `react-dom`, `@types/react`
- [x] 1.2 メイン / preload / レンダラの3ビルドターゲットを持つ Vite 設定を作る
- [x] 1.3 `package.json` に `main` エントリと開発起動スクリプトを追加する
- [x] 1.4 `tsconfig` をメイン（Node）とレンダラ（DOM）で分離する
- [x] 1.5 `app.enableSandbox()` を呼ぶ最小の `src/main/main.ts` を作り、空ウィンドウが起動することを確認する

## 2. ナビゲーションガード

- [x] 2.1 `src/main/NavigationGuard.ts` に許可ドメインの正規表現リストを定義する（`signin.aws.amazon.com`, `*.console.aws.amazon.com`, `*.awsapps.com`, `*.amazonaws.com`, `*.aws.amazon.com`, `*.awsstatic.com`, `*.cloudfront.net`, `docs.aws.amazon.com`, `health.aws.amazon.com`）
- [x] 2.2 `isAllowed(url: string): boolean` を実装する — URL パース失敗時は例外を投げず `false` を返す
- [x] 2.3 `isAllowed` のユニットテストを書く（許可 / 非許可 / パース不能 / サブドメイン境界のケース）
- [x] 2.4 `will-navigate` ハンドラを実装し、許可外は `preventDefault()` + `shell.openExternal()` にする
- [x] 2.5 `setWindowOpenHandler` を実装し、**常に `{ action: 'deny' }` を返す**。許可内は `TabManager.openTab` に委譲、許可外は `shell.openExternal()`

## 3. ウィンドウとタブ

- [x] 3.1 `src/main/main.ts` で `BaseWindow`（`titleBarStyle: 'hiddenInset'`）を生成する
- [x] 3.2 `src/main/partition.ts` にパーティション名生成ヘルパを作る — `persist:` プレフィックスを関数内で必ず付与する
- [x] 3.3 `src/main/TabManager.ts` を作成し、タブの状態モデル（id / accountRoleKey / url / title / view）を定義する。将来のハイバネート状態を見越した余地を残す
- [x] 3.4 `openTab({ accountRoleKey, url })` を実装する — `WebContentsView` を生成し、`contentView` に追加して URL をロードする
- [x] 3.5 `WebContentsView` の `webPreferences` を確定する: `partition`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, `preload`
- [x] 3.6 `selectTab(id)` を実装する — 直前のビューを `removeChildView()` でデタッチし、選択ビューを表示する（**破棄しない**）
- [x] 3.7 `closeTab(id)` を実装する — ビューを取り除き `webContents` を破棄する
- [x] 3.8 ウィンドウリサイズに追従して表示中ビューの `setBounds()` を更新する（`x` = サイドパネル幅、`y` = タイトルバー高さ）
- [x] 3.9 サイドパネルの折りたたみ / 復帰 / 幅変更に応じて `setBounds()` を更新する
- [x] 3.10 生成した各タブに 2.4 / 2.5 のハンドラを登録する

## 4. preload とアプリ UI

- [x] 4.1 `src/preload/preload-aws.ts` を作成する（この時点では中身をほぼ空にし、`contextBridge` の器のみ用意する）
- [x] 4.2 `src/renderer/SidePanel.tsx` を作り、アカウント / タブ / TOTP の3セクションを縦に並べる骨格を作る（この change ではタブセクションのみ実装し、他は器のみ）
- [x] 4.3 タブセクションを縦型リストとして実装する — タブの一覧表示・選択・クローズ
- [x] 4.4 各セクションが独立してスクロールするレイアウトにする
- [x] 4.5 サイドパネルの折りたたみと幅変更を実装する
- [x] 4.6 タブ操作のための IPC チャネル（レンダラ → メイン）を定義する
- [x] 4.7 タブ状態の変化をメイン → レンダラへ通知する IPC を実装する
- [x] 4.8 アプリ UI に Content-Security-Policy を設定する

## 5. DevTools

- [x] 5.1 `Cmd+Opt+I` で表示中タブの `webContents.openDevTools({ mode: 'right' })` を呼ぶ
- [x] 5.2 `Cmd+Opt+Shift+I` でアプリ UI レンダラの DevTools を開く

## 6. 検証

利用者判断によりスキップ。既定ブラウザが Chrome のため、コンソールが Electron シェルではなく Chrome で開いてしまう。URL ハンドオフ等の後続 change が揃ってから実機再検証する。

- [x] 6.1 固定パーティション名で AWS コンソールを開き、表示されることを確認する
- [x] 6.2 `verify-sso-federation-spike` で生成した2アカウントのログインURLを、**異なるパーティションのタブでそれぞれ開き、同時にサインイン状態を保てることを確認する**
- [x] 6.3 アプリを再起動し、`persist:` パーティションの Cookie が保持されていることを確認する
- [x] 6.4 コンソールからドキュメントリンク（`docs.aws.amazon.com`）を開き、同一パーティションのタブで開くことを確認する
- [x] 6.5 コンソールから許可外の外部リンクを開き、既定ブラウザに委譲されることを確認する
- [x] 6.6 CloudShell を開き、同一パーティションのタブで動作することを確認する
- [x] 6.7 コンソールのアセットが欠けずに表示されることを確認し、必要なら許可リストにドメインを追加する
- [x] 6.8 タブ切替が即座に完了し、切替後に再読込が発生しないことを確認する
- [x] 6.9 サイドパネルの折りたたみ / 復帰 / 幅変更で `WebContentsView` の bounds が正しく追従し、ビューがパネルに潜り込まないことを確認する
- [x] 6.10 コンソールのタブタイトルが縦型リストで潰れずに識別できることを確認する
- [x] 6.11 DevTools が両側で開くことを確認する
