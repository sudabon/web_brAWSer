## Why

AWS の作業を既定ブラウザから隔離し、専用ウィンドウで扱えるようにする。`verify-sso-federation-spike` で認証フローの成立が確認できた前提で、それを載せる器（Electron シェル）を最小構成で立ち上げる。

同時に、本アプリを「ブラウザ」ではなく「AWSクライアント」に限定する境界線をここで引く。許可ドメイン外へのナビゲーションを既定ブラウザへ委譲することで、拡張機能・DRM・任意サイト互換性といった汎用ブラウザ実装の困難さを設計上すべて対象外にする。

## What Changes

- Electron + TypeScript のアプリ骨格を追加し、`BaseWindow` + `WebContentsView`（`BrowserView` は非推奨のため使わない）でウィンドウとタブを構成する
- タブ1つ = `WebContentsView` 1つ とし、生成・破棄・レイアウト・切替を担う `TabManager` をメインプロセスに置く
- 許可ドメインリストによるナビゲーションガードを実装する。`will-navigate` と `setWindowOpenHandler` の両方で判定し、許可外は `shell.openExternal()` で既定ブラウザへ委譲する
- AWS コンソールが多用する `window.open` を、**同一パーティション**の新規タブとして開く（別パーティションで開くとセッションが切れて事故る）
- コンテンツ側 `Cmd+Opt+I` / アプリUI側 `Cmd+Opt+Shift+I` で DevTools を開けるようにする
- セキュリティ既定値を確定する: `app.enableSandbox()`、`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、アプリUIへの CSP 設定
- アプリUIの最小レンダラを追加する。タブは上部の水平タブバーではなく、**左サイドパネルの縦型リスト**として配置し、パネルを「アカウント / タブ / TOTP」の3セクションに区切る骨格を用意する（この change ではタブセクションのみ実装する）
- サイドパネルの折りたたみと幅変更を実装し、コンテンツ領域の bounds が追従するようにする

この段階では SSO 連携・サイドバー・TOTP は含まない。パーティション名はハードコードした固定値で動作確認する。

## Capabilities

### New Capabilities

- `console-window-shell`: `BaseWindow` + `WebContentsView` によるウィンドウとタブの生成・破棄・レイアウト・切替、パーティション指定による Cookie 分離、DevTools のオープン。
- `navigation-guard`: 許可ドメイン判定に基づくナビゲーション制御。許可内は同一パーティションのタブで開き、許可外は既定ブラウザへ委譲する。

### Modified Capabilities

なし

## Impact

| 対象 | 内容 |
|---|---|
| 新規ファイル | `src/main/main.ts`, `src/main/TabManager.ts`, `src/main/NavigationGuard.ts`, `src/preload/preload-aws.ts`, `src/renderer/SidePanel.tsx` |
| 新規依存 | `electron`, `electron-builder`(devのみ), `vite`, `react`（アプリUI） |
| 前提 | `verify-sso-federation-spike` の検証が PASS していること |
| 影響範囲 | 以降のすべての change が本シェルの上に載る。`TabManager` と `NavigationGuard` のインターフェースが後続の契約になる |
| セキュリティ | サンドボックス有効・contextIsolation 有効を既定とし、以降の change でこれを緩めない |
