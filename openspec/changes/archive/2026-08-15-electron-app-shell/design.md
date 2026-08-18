## Context

`verify-sso-federation-spike` で認証フローの成立が確認された前提で、それを載せる器を作る。この change が確立するインターフェース（`TabManager` / `NavigationGuard` / パーティション命名規則 / セキュリティ既定値）は、後続4つの change すべての土台になる。

同時に本 change は**アプリの境界線を引く**。許可ドメイン外を既定ブラウザへ委譲することで、拡張機能・DRM・任意サイト互換性という汎用ブラウザ実装の困難さを設計上すべて対象外にする。この一点で「ブラウザを作る」から「AWSクライアントを作る」へスコープが変わる。

## Goals / Non-Goals

**Goals:**

- `BaseWindow` + `WebContentsView` によるタブの生成・破棄・切替・レイアウトを動かす
- パーティション指定による Cookie 分離が実機で機能することを確認する
- 許可ドメインガードと `window.open` ハンドリングを実装する
- DevTools を両側（コンテンツ / アプリUI）で開けるようにする
- セキュリティ既定値をここで固定し、以降緩めない

**Non-Goals:**

- SSO 連携、サイドバー、アカウント管理（`sso-account-directory`）
- タブの永続化・ハイバネート（`workspace-persistence-guardrails`）
- TOTP（`builtin-totp`）
- パッケージング・署名（`packaging-and-url-handoff`）
- 「軽量化」。AWSコンソールは重量級SPAであり、UIを削っても消費メモリはほぼ変わらない。得られるのは起動速度とワークフローの摩擦低減である

## Decisions

### D1: Electron を採用し Tauri を採らない

決定打は2点。

1. **DevTools が1行**。`webContents.openDevTools({ mode: 'right' })` で済む。Tauri（WKWebView）では Safari Web Inspector の外部接続になり常用に耐えない。日常的に AWS コンソールをデバッグする用途では致命的
2. **AWSコンソールがテスト対象としているのが Chromium**。WKWebView は主要検証対象ではなく、互換性問題を踏むリスクが高い

加えて `session.fromPartition()` による Cookie 分離と `safeStorage` の Keychain 連携が標準で揃う。バンドルサイズは犠牲にする。

### D2: `BaseWindow` + `WebContentsView` を使い `BrowserView` は使わない

`BrowserView` は Electron 30 以降で非推奨。`BaseWindow` + `WebContentsView` が推奨 API であり、複数ビューのレイアウト管理が素直に書ける。

### D3: タブ非表示は `removeChildView()` によるデタッチとし、破棄しない

タブ切替のたびに `webContents` を破棄すると再読込コストが毎回かかる。デタッチであればビューは生きたまま非表示になり、切替が即座に終わる。破棄を伴うライフサイクル（ハイバネート）は `workspace-persistence-guardrails` で別途導入する。この change ではデタッチのみを扱い、`TabManager` の状態モデルにハイバネートを見越した余地だけ残す。

### D4: `window.open` は必ず同一パーティションで開く

AWSコンソールは `window.open` を多用する（ドキュメント、CloudShell、サービス間遷移、S3プレビュー、CloudWatch の新規ウィンドウ）。ここで**別パーティションで開くとセッションが切れて事故る**。`setWindowOpenHandler` は常に `{ action: 'deny' }` を返し、タブ生成は自前の `TabManager` に一本化する。Electron 既定のウィンドウ生成経路を残さないことで、パーティション指定の抜け道をなくす。

```ts
view.webContents.setWindowOpenHandler(({ url }) => {
  if (isAllowed(url)) {
    tabManager.openTab({ accountRoleKey: currentKey, url })  // 同じパーティション
  } else {
    shell.openExternal(url)
  }
  return { action: 'deny' }
})
```

### D5: ナビゲーションガードは2箇所で判定する

`will-navigate`（タブ内遷移）と `setWindowOpenHandler`（新規ウィンドウ）は別経路であり、両方を塞がないと漏れる。判定関数 `isAllowed(url)` は単一の実装を共有し、URL パース失敗時は例外を投げずに `false` を返す（不正 URL を許可側に倒さない）。

許可リストはホスト名の正規表現で持つ。`*.amazonaws.com` は CloudShell・S3署名URL・各種アセットのために必要で、範囲は広いが AWS 管理下のドメインであり許容する。

### D6: セキュリティ既定値をここで固定する

`app.enableSandbox()`、`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`、アプリUIへのCSP、リモートモジュール無効（Electron既定）。preload は最小限のスクリプトのみ指定する。

**preload の責務はプロジェクト全体で2つに限定する**: (1) アカウント色バーの注入（`workspace-persistence-guardrails`）、(2) Identity Center サインインページでの MFA 入力ボタン表示（`builtin-totp`）。この change では preload の器だけ用意し、中身は空に近い状態にする。責務を増やさないことが、サンドボックスを有効に保つ前提になる。

### D7: アプリUIは React + Vite

左サイドパネル（アカウント / タブ / TOTP の3セクション）とコマンドパレットのみで規模は小さいが、後続 change で状態を持つ UI が増える。素の TypeScript でも足りるが、React にしておくほうが後続の実装速度が出る。

### D8: この change ではパーティション名をハードコードする

アカウント一覧は `sso-account-directory` の担当であり、ここでは固定パーティション名（例: `persist:acct-<ダミーID>-<ダミーロール>`）でシェルの動作を確認する。パーティション命名規則 `persist:acct-<accountId>-<roleName>` だけを決め、値の供給元は後続 change に委ねる。

### D9: タブは上部の水平タブバーではなく、左サイドパネルの縦型リストとして配置する

アプリのクロームは自前の React UI であり、Electron 側にレイアウトの制約はない。`WebContentsView.setBounds()` のオフセットを `y` から `x` に変えるだけで、実装コストは水平タブバーと変わらない。

左配置を選ぶ理由は3点。

1. **二層モデルがそのまま縦に並ぶ**。本アプリの構造は `アカウント → タブ` であり、単一の左パネルを上下に区切って「上=アカウントツリー、下=現在アカウントのタブ」と積むだけで、構造と見た目が一致する。水平タブバーだと二層が直交してしまい、対応関係が視覚的に読み取りにくい
2. **AWSコンソールはタブタイトルが長い**。"EC2 Management Console"、"S3 buckets"、"CloudWatch dashboards" などが並ぶため、水平タブでは推奨上限の10タブに達する前に文字が潰れる。縦型リストならパネル幅いっぱいを使えて識別できる
3. **ガードレールが強化される**。左端にアカウント色の面が常時出るため、上部の細いラインより周辺視野で捉えやすい（`workspace-persistence-guardrails` の D5 と連動する）

**採らなかった代替案**:

- *2列（左端に細いアカウントレール + タブリスト、Slack/Discord風）*: アカウント色の可視性は最も高いが、本件の想定（多数アカウント）ではレールが縦に伸びすぎて識別不能になる。残り時間やロール名もレール幅に入らない
- *タブのみのパネル（アカウント全一覧は `Cmd+Shift+A` パレットに寄せる、Arc風）*: 見た目は最も静かだが、「どのアカウントがもうすぐ切れるか」の常時監視を捨てることになる。`console-session-lifecycle` の残り時間表示（10分で黄色、期限切れで灰色）が活きない

**トレードオフ**: 横幅を約260px消費する。CloudWatch ダッシュボードや VPC 図など幅が欲しい画面があるため、**パネルの折りたたみと幅変更を必須要件に含める**（折りたたみのショートカット割当は `workspace-persistence-guardrails` の `keyboard-shortcuts` で確定する）。

### D10: セクションは独立してスクロールさせる

アカウントセクションは40件規模になりうる一方、タブセクションはアカウントあたり10件程度に収まる。パネル全体を1つのスクロール領域にすると、タブを見るためにアカウントを跨いでスクロールする羽目になる。

アカウントセクションのみスクロールさせ、タブセクションと TOTP セクションは表示位置を保つ。

## Risks / Trade-offs

| リスク | 影響 | 緩和 |
|---|---|---|
| `persist:` プレフィックスの付け忘れ | メモリ内セッションになり再起動で Cookie が消える | パーティション名の生成を単一のヘルパ関数に集約し、プレフィックスを関数内で付与する |
| `window.open` の経路漏れ | 別パーティションで開いてセッション切断 | `setWindowOpenHandler` を常に `deny` にし、タブ生成を `TabManager` に一本化する |
| 許可リストが狭すぎてコンソールが壊れる | アセットが読めず表示崩れ | `*.amazonaws.com` / `*.awsstatic.com` / `*.cloudfront.net` を含める。実機で崩れが出たら追加する |
| 許可リストが広すぎる | 「AWSクライアント」の境界が緩む | すべて AWS 管理下または AWS のアセット配信に限定し、汎用ドメインを入れない |
| WebContentsView 多数によるメモリ増 | 常用時に重くなる | この change では対処しない。`workspace-persistence-guardrails` のハイバネートで対応する |
| サイドパネルが横幅を約260px消費する | 幅の欲しいコンソール画面（CloudWatch ダッシュボード、VPC 図）が窮屈になる | D9 のとおり折りたたみと幅変更を必須要件にする。既定幅は実機で調整する |
| `setBounds()` の更新漏れでビューがパネルに潜り込む | 表示崩れ | bounds の算出を単一の関数に集約し、リサイズ / 折りたたみ / 幅変更のすべてがその関数を経由するようにする |
| Chromium の CVE | セキュリティ | `packaging-and-url-handoff` の `electron-updater` で対応する。それまでは開発用途に留める |

## Migration Plan

既存実装はないため移行はない。`verify-sso-federation-spike` の `spike/` は残したまま、`src/` 配下に本体を新設する。

## Open Questions

- サイドパネルの既定幅（暫定260px）と最小 / 最大幅 — 実機で調整する
- `*.cloudfront.net` を許可リストに含めるか — 実機でアセット読み込みを確認して決める
- アプリUI を `WebContentsView` として載せるか、`BaseWindow` の直下に別レイヤで持つか — 実装時に確定する
- 折りたたみ状態とパネル幅を永続化するか — する場合は `workspace-persistence-guardrails` の `config.json` に載せる
