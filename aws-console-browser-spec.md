# AWS Console Browser — 実装仕様書

**版**: 0.1
**日付**: 2026-08-15
**対象**: macOS（Apple Silicon / Intel）
**想定工数**: 4〜5日

---

## 0. サマリ

AWSマネジメントコンソール**専用**のデスクトップアプリ。IAM Identity Center 配下の多数のアカウント／ロールを、**アカウントごとに独立したセッションで**、**タブを溢れさせずに**扱うことを目的とする。TOTP生成と開発者ツールを内蔵する。

汎用ブラウザは作らない。許可ドメイン外へのナビゲーションは既定ブラウザに投げる。この一点によって、拡張機能・DRM・任意サイト互換性といった「ブラウザを作る難しさ」の大半が対象外になる。

中核となる技術判断は次の1点に集約される。

> **AWSのCookieを共有せず、SSOのアクセストークンから accountId × roleName ごとに federation サインインURLを生成し、専用パーティションのWebViewでそこへナビゲートする。**

これにより、AWS純正マルチセッションの5セッション上限を受けずに、アカウント数の制限なく同時サインイン状態を維持できる。TOTPの入力はSSOポータルへのログイン1回のみで済む。

---

## 1. 背景と目的

### 1.1 現状の課題

| 課題 | 詳細 |
|---|---|
| タブの氾濫 | 既定ブラウザ（Chrome）を他アプリと共用しており、AWSのタブが他の作業タブに埋もれる |
| アカウント切替の摩擦 | Identity Center から多数のアカウントIDを使い分ける。ポータル → アカウント選択 → ロール選択 → 新規タブ、が毎回発生 |
| セッションの衝突 | 素のブラウザでは同一ドメインのCookieを共有するため、複数アカウントの同時サインインに制約がある |
| TOTPが外部依存 | Chrome拡張 Authenticator に依存。ブラウザを分けると使えない |
| 事故リスク | 「今どのアカウントを見ているか」が視覚的に弱い |

### 1.2 本アプリが解決すること

- AWS作業を専用ウィンドウに隔離する（他アプリのタブと混ざらない）
- アカウント×ロールを**サイドバーの一覧**として扱い、タブの本数と切り離す
- アカウントごとに完全に独立したCookieジャーを持つ
- TOTPをアプリに内蔵する
- Identity Center のサインイン ID/パスワードをアプリに内蔵する（TOTP と同居するリスクを受け入れたうえで、§6.3 の条件下で保管する）
- アカウントごとの色分けで、prod誤操作を物理的に見えるようにする

### 1.3 非目標（明示的に作らない）

- 汎用ブラウザ機能（任意サイトの閲覧、ブックマーク同期、拡張機能）
- Google Cloud など AWS 以外のコンソール対応
- 汎用のパスワードマネージャ機能（Identity Center のサインイン情報のみ扱い、AWS 以外のサイトの資格情報は扱わない）
- モバイル対応、Windows / Linux 対応（将来検討）
- 「軽量化」そのもの — AWSコンソールは重量級SPAであり、UIを削っても消費メモリはほぼ変わらない。得られるのは起動速度とワークフローの摩擦低減であって、軽さではない

---

## 2. アーキテクチャ

### 2.1 技術スタック

| 領域 | 選定 | 理由 |
|---|---|---|
| シェル | **Electron**（最新安定版）+ TypeScript | `openDevTools()` が1行、`session.fromPartition()` によるCookie分離、`safeStorage` のKeychain連携。AWSコンソールがテスト対象としているChromiumと同一エンジン |
| ウィンドウ | `BaseWindow` + `WebContentsView` | Electron 30以降の推奨API。`BrowserView` は非推奨 |
| UI（アプリ自身のクローム） | React + Vite（または素のTS） | タブバー・サイドバー・TOTPパネルのみ。規模は小さい |
| AWS SDK | `@aws-sdk/client-sso-oidc`, `@aws-sdk/client-sso` | device auth とロール認証情報取得 |
| QRデコード | `zxing-wasm` | `jsQR` より低解像度・傾きに強い |
| TOTP | `otpauth`（RFC 6238） | 自前実装でも30行程度だが、テスト済みのものを使う |
| 配布 | `electron-builder` + `electron-updater` | Chromium のCVE追従を自動化する |

**Tauri を採用しない理由**: DevToolsがSafari Web Inspectorの外部接続になり常用に向かない。またWKWebViewはAWSコンソールの主要検証対象ではない。バンドルサイズは犠牲にする。

### 2.2 プロセス構成

```
Main Process
├── SsoManager        … device auth、トークン管理、ListAccounts/ListAccountRoles
├── FederationService … GetRoleCredentials → getSigninToken → login URL 生成
├── SessionManager    … partition の生成・管理、Cookie 分離
├── TabManager        … WebContentsView の生成/破棄/ハイバネート/レイアウト
├── TotpStore         … シード管理（safeStorage 暗号化）、コード生成
├── DownloadManager   … will-download のハンドリング
└── NavigationGuard   … 許可ドメイン判定、外部ブラウザへの委譲

Renderer (アプリUI)   … サイドバー / タブバー / TOTPパネル / コマンドパレット
Renderer (AWS content) … WebContentsView × N（sandbox: true、preload は最小限）
```

**一時認証情報（AccessKey/SecretKey/SessionToken）はメインプロセスのメモリにのみ置く。** レンダラには渡さない。ディスクにも書かない。ログにも出さない。

---

## 3. 認証フロー（本仕様の中核）

### 3.1 採用方式: SSO device authorization → GetRoleCredentials → federation endpoint

```
┌─ 初回のみ ────────────────────────────────────────┐
│ 1. sso-oidc:RegisterClient(clientName, clientType='public')
│      → clientId, clientSecret（約90日有効）
└───────────────────────────────────────────────────┘

┌─ SSOセッション確立（TOTPを使うのはここ1回だけ）────┐
│ 2. sso-oidc:StartDeviceAuthorization(clientId, clientSecret, startUrl)
│      → deviceCode, userCode, verificationUriComplete, interval
│
│ 3. アプリ内の専用パーティション persist:sso-portal で
│    verificationUriComplete を開く
│      → Identity Center サインイン画面
│      → ID/パスワード入力 → MFA入力（内蔵TOTPからワンクリック）
│      → 「Allow」をクリック
│
│ 4. sso-oidc:CreateToken をポーリング
│    grantType='urn:ietf:params:oauth:grant-type:device_code'
│      → accessToken（既定8時間、Identity Center のセッション設定に依存）
│      → refreshToken（設定により発行）
└───────────────────────────────────────────────────┘

┌─ アカウント一覧の取得 ────────────────────────────┐
│ 5. sso:ListAccounts(accessToken)
│      → accountId, accountName の一覧
│    sso:ListAccountRoles(accessToken, accountId)
│      → roleName の一覧
│    → サイドバーに accountId × roleName のツリーを構築
│      （★ここが「タブを消費しない」肝。一覧はタブではない）
└───────────────────────────────────────────────────┘

┌─ アカウントへの接続（ワンクリック、追加ログインなし）─┐
│ 6. sso:GetRoleCredentials(accessToken, accountId, roleName)
│      → { accessKeyId, secretAccessKey, sessionToken, expiration }
│
│ 7. GET https://signin.aws.amazon.com/federation
│      ?Action=getSigninToken
│      &Session=<urlencode(JSON)>
│
│    JSON = {
│      "sessionId":    accessKeyId,
│      "sessionKey":   secretAccessKey,
│      "sessionToken": sessionToken
│    }
│      → { "SigninToken": "..." }
│
│ 8. ログインURLを組み立て
│    https://signin.aws.amazon.com/federation
│      ?Action=login
│      &Issuer=<urlencode("https://localhost/aws-console-browser")>
│      &Destination=<urlencode(コンソールURL)>
│      &SigninToken=<SigninToken>
│
│ 9. partition = persist:acct-<accountId>-<roleName> の
│    WebContentsView で 8. のURLへナビゲート
│      → そのビューだけがそのアカウントのコンソールセッションを持つ
└───────────────────────────────────────────────────┘
```

### 3.2 実装上の注意点

| 項目 | 内容 |
|---|---|
| **URLの有効期限** | 手順8で生成したログインURLは**15分間のみ有効、実質ワンショット**。生成したら即座にナビゲートする。保存・使い回しをしない |
| **`SessionDuration` パラメータ** | 公式ドキュメント上、`AssumeRole*` 系で取得した認証情報の場合のみ付与でき、最大43200秒（12時間）。ただし `sso:GetRoleCredentials` の認証情報で受け付けられるかは実測が必要。**まず省略して実装する。** 省略時のコンソールセッション長は認証情報の有効期限に従う |
| **セッションを伸ばしたい場合** | `SessionDuration` に頼るより、**ロール側の max session duration を12時間に引き上げる**方が確実。`SessionDuration` はロールの最大セッション長以上には指定できない |
| **リージョン** | `Destination` に `https://ap-northeast-1.console.aws.amazon.com/console/home?region=ap-northeast-1` を指定して、東京リージョンで開く |
| **POST も可** | `getSigninToken` はGET・POSTどちらも受け付ける。認証情報がURLに載るのを避けたければPOSTを使う（ローカル通信なのでGETでも実害は小さいが、POSTを推奨） |

### 3.3 セッション期限の扱い

- `GetRoleCredentials` の `expiration` をアカウントごとに保持する
- サイドバーに残り時間を表示。残り10分を切ったら黄色、期限切れは灰色
- **期限切れのタブを操作した場合**: SSO accessToken が生きていれば、6→9を無言で再実行し、直前のURLへ戻す（ユーザーには一瞬のリロードにしか見えない）
- **SSO accessToken 自体が切れた場合**: device auth をやり直す（TOTP入力1回）。refreshToken が発行されていればそれを先に試す

### 3.4 不採用方式の記録

**AWS純正マルチセッション**: アカウントメニューから opt-in すると、最大5つのアイデンティティに同一ブラウザで同時サインインでき、各セッションが `<accountId>-<hash>.<region>.console.aws.amazon.com` のサブドメインを持つ。実装は圧倒的に楽（ただのブラウザで済む）が、

- **5セッション上限**があり、多数アカウントを扱う本件の課題を解決しない
- opt-in が必要でブックマークURLが変わる
- 一部サービス（Marketplace等）でサブドメインが落ちる不具合報告がある

ただし**方式Aが何らかの理由で成立しない場合のフォールバック**として位置づける。

---

## 4. 機能仕様

### 4.1 アカウント管理（サイドバー）

```
┌──────────────────────┐
│ 🔑 SSO: 7h 12m       │  ← SSOセッション残り
├──────────────────────┤
│ ● prod-web           │  ← 色ドット = アカウント色
│   AdministratorAccess│     接続中は塗り、未接続は輪郭
│   11:42 まで          │
│ ○ prod-batch         │
│   ReadOnlyAccess     │
│ ● stg-web            │
│   AdministratorAccess│
│   09:15 まで          │
│ ○ sandbox-01         │
│ ...                  │
├──────────────────────┤
│ 🔐 TOTP              │
└──────────────────────┘
```

- `ListAccounts` / `ListAccountRoles` の結果をキャッシュ（手動リフレッシュ可）
- アカウントごとに **色**・**タグ（prod/stg/dev/sandbox）**・**既定リージョン**をユーザーが設定できる
- クリックで接続（未接続なら federation を実行して最初のタブを開く）
- `Cmd+Shift+A` でfuzzy検索付きのアカウント切替パレット ← **本アプリの主役機能**

### 4.2 タブ管理

**二層モデル: アカウント → タブ**

タブは常に「今選択中のアカウント」に属するものだけが表示される。これがタブ氾濫の解決策そのもの。40タブ開いていても、視界には現在のアカウントの3〜4タブしか出ない。

| 項目 | 仕様 |
|---|---|
| 実装 | タブ1つ = `WebContentsView` 1つ。非表示タブは `contentView.removeChildView()` でデタッチ（破棄はしない） |
| ハイバネート | 30分（設定可）非アクティブなタブは `webContents` を破棄し、URL/タイトル/faviconのみ保持。再選択時に再ナビゲート。**コンソールセッションはCookie側にあるので、復元は単なる再読込で済む** |
| 永続化 | `tabs.json` にタブツリーを保存。起動時は**全タブをハイバネート状態で復元**するため起動が速い |
| 上限 | アカウントあたり推奨10タブ。超えたら古い順に自動ハイバネート |
| 表示 | タブバーはアカウント色の細いラインを持つ |

### 4.3 TOTP

#### インポート経路

1. **画面上のQRを範囲選択で取り込む** — `screencapture -i` を `child_process` 経由で呼び、生成されたPNGをデコード（macOSでは最も実用的）
2. **画像ファイルのドラッグ&ドロップ**
3. **`otpauth://` URI の貼り付け**
4. **Base32シークレットの直接入力**
5. **Chrome拡張 Authenticator のバックアップJSONインポート**（移行用、初回のみ）

`otpauth-migration://offline?data=<base64 protobuf>`（Google Authenticator形式のエクスポート）に対応する場合はprotobufデコードが必要。優先度は低い。

#### パース対象

```
otpauth://totp/{issuer}:{label}?secret=BASE32&issuer=...&algorithm=SHA1&digits=6&period=30
```

`algorithm` / `digits` / `period` は省略時の既定値（SHA1 / 6 / 30）で扱う。AWS Identity Center は標準的なTOTPなので既定で足りる。

#### 保管

```
~/Library/Application Support/aws-console-browser/totp.enc
```

- `safeStorage.encryptString(JSON.stringify(seeds))` で暗号化。macOSではKeychain由来の鍵が使われる
- **アプリに署名がないと、起動のたびにKeychainのプロンプトが出る。** 開発中は許容できるが、常用するならad-hoc署名以上を推奨
- 起動後の初回参照時に Touch ID で解錠（`systemPreferences.promptTouchID()`）。以降はメモリ保持、スリープ復帰でロック

#### 入力補助

- **自動入力はしない。** サイドパネルに現在のコードと残り秒数のリングを表示し、クリックでクリップボードへコピー（30秒後に自動クリア）
- Identity Center のサインインページ**に限り**、preloadからMFA入力欄を検出し「入力する」ボタンをオーバーレイ表示。ワンクリックで挿入するが、**自動送信はしない**
- 対象が1ページだけなので、AWS側のUI変更への追従コストが小さい。ここが「汎用ブラウザで自動入力を作る」場合との決定的な差

#### セキュリティ上の注意（重要）

このアプリは**第1要素（コンソールを開く手段）と第2要素（TOTPシード）を同一プロセスに同居させる**。アプリまたはユーザーディレクトリが侵害された時点で、MFAは防御として機能しなくなる。

緩和策:

1. `safeStorage` + Touch ID ゲート（上記）
2. **ルートアカウントとブレークグラス用のシードは、このアプリに入れない。** 別デバイスまたは1Password等に残す
3. Identity Center 側で可能なら FIDO2/パスキーへ移行し、TOTPは非常用に留める（ただしWebView内のWebAuthnは挙動が不安定なため、本アプリのフローとは相性が悪い。M0で要検証）

### 4.4 開発者ツール

| 対象 | ショートカット | 実装 |
|---|---|---|
| AWSコンソールのページ | `Cmd+Opt+I` | `activeTab.webContents.openDevTools({ mode: 'right' })` |
| アプリ自身のUI | `Cmd+Opt+Shift+I` | アプリUIのrendererに対して同様 |

Electronを選んだ最大の理由がこれ。実装コストは実質ゼロ。

### 4.5 ナビゲーションガード（許可ドメイン）

```
signin.aws.amazon.com
*.console.aws.amazon.com
*.awsapps.com            ← Identity Center ポータル
*.amazonaws.com          ← CloudShell、S3署名URL、各種アセット
*.aws.amazon.com
*.awsstatic.com
*.cloudfront.net         ← コンソールのアセット配信（必要に応じて）
docs.aws.amazon.com
health.aws.amazon.com
```

- `will-navigate` と `setWindowOpenHandler` で判定
- 許可外は `shell.openExternal()` で既定ブラウザへ
- **この許可リストが、本アプリを「ブラウザ」ではなく「AWSクライアント」に変える。** 拡張機能・DRM・任意サイト互換性の問題がすべて対象外になる

### 4.6 `window.open` の扱い

AWSコンソールは `window.open` を多用する（ドキュメント、CloudShell、サービス間遷移、S3プレビュー、CloudWatchの新規ウィンドウ）。

```ts
view.webContents.setWindowOpenHandler(({ url }) => {
  if (isAllowed(url)) {
    tabManager.openTab({ accountRoleKey: currentKey, url })  // ★同じパーティション
    return { action: 'deny' }
  }
  shell.openExternal(url)
  return { action: 'deny' }
})
```

**同じパーティションで開くこと**が必須。別パーティションで開くとセッションが切れて事故る。

### 4.7 ダウンロード

対象: 認証情報CSV、コストレポート、CloudFormationテンプレート、S3オブジェクト、ログのエクスポート

```ts
session.on('will-download', (event, item) => {
  item.setSavePath(path.join(app.getPath('downloads'), 'AWS', accountAlias, item.getFilename()))
})
```

- アカウント別のディレクトリに自動振り分け（`~/Downloads/AWS/prod-web/`）
- 完了通知。最低限これだけあれば実用に足りる

### 4.8 誤操作防止（ガードレール）

マルチアカウント運用では、実用上これが最も効く機能。

- アカウントごとに設定した色を、preloadから **`document.documentElement` の上端6pxバー**として注入
- ウィンドウのタイトルバー／タブの色も同色にする
- `prod` タグのアカウントはタブに警告アイコンを表示
- 「今どのアカウントにいるか」が常に視界の端に入る状態を作る

---

## 5. データモデル

```ts
type AccountRole = {
  accountId: string          // "123456789012"
  accountName: string        // "prod-web"
  roleName: string           // "AdministratorAccess"
  partition: string          // "persist:acct-123456789012-AdministratorAccess"
  color: string              // "#e11d48"
  tags: ("prod" | "stg" | "dev" | "sandbox")[]
  defaultRegion: string      // "ap-northeast-1"
}

type ConsoleSession = {
  accountRoleKey: string     // `${accountId}#${roleName}`
  expiration: number         // GetRoleCredentials の expiration（epoch ms）
  connectedAt: number
}

type Tab = {
  id: string
  accountRoleKey: string
  url: string
  title: string
  hibernated: boolean
  lastActiveAt: number
}

type SsoState = {
  startUrl: string           // "https://d-xxxxxxxxxx.awsapps.com/start"
  region: string             // Identity Center のリージョン
  registration: { clientId: string; clientSecret: string; expiresAt: number }
  accessToken: string
  refreshToken?: string
  expiresAt: number
}

type TotpSeed = {
  id: string
  issuer: string
  label: string
  secret: string             // Base32
  algorithm: "SHA1" | "SHA256" | "SHA512"
  digits: number
  period: number
}
```

### 5.1 ファイル配置

```
~/Library/Application Support/aws-console-browser/
├── config.json       # アカウント設定、色、タグ、既定リージョン（平文で可）
├── tabs.json         # タブ状態（平文で可）
├── sso.enc           # SsoState（safeStorage 暗号化）
├── totp.enc          # TotpSeed[]（safeStorage 暗号化）
└── Partitions/       # Electron が管理するパーティションごとのCookie等
```

`AccountRole.partition` の命名は `persist:` プレフィックス必須（これがないとメモリ内セッションになり、再起動でCookieが消える）。

---

## 6. セキュリティ仕様

### 6.1 WebContentsView の設定

```ts
new WebContentsView({
  webPreferences: {
    partition: accountRole.partition,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    preload: path.join(__dirname, 'preload-aws.js'),
  },
})
```

### 6.2 preload の責務（これ以上増やさない）

1. アカウント色バーの注入
2. Identity Center サインインページでのMFA入力ボタン表示
3. Identity Center サインインページでのID/パスワード入力ボタン表示

`contextBridge.exposeInMainWorld` で公開するAPIは、上記に必要な最小のIPCチャネルのみ。
ただし **ID/パスワードは contextBridge に出さない**。ページ側の JS から読めてしまうため、
preload 内のボタンだけが `credentials:fill` を叩き、復号値は preload の外へ出ない。

### 6.3 認証情報の取扱い

| 対象 | 保管場所 | 備考 |
|---|---|---|
| 一時認証情報（AccessKey/Secret/SessionToken） | **メインプロセスのメモリのみ** | ディスクに書かない。レンダラに渡さない。ログに出さない |
| SigninToken | メモリ、使用後即破棄 | 15分・ワンショット |
| SSO accessToken | `sso.enc`（safeStorage） | |
| TOTPシード | `totp.enc`（safeStorage） | + Touch IDゲート |
| Identity Center の ID/パスワード | `creds.enc`（safeStorage） | + Touch IDゲート。レンダラにはユーザー名のみ返し、パスワードはサインイン画面の preload にのみ渡す |

**ID/パスワードと TOTP を同居させた時点で、MFA は防御として機能しない。** ルートアカウントおよび
ブレークグラス用の資格情報は登録しない。自動入力はサインインボタンの押下までで、送信は自動化しない。

### 6.4 その他

- アプリ自身のUIにCSPを設定
- `app.enableSandbox()`
- リモートモジュールは無効（Electron既定）
- `electron-updater` によるChromium CVE追従を**必ず有効にする**。信頼できないコードを実行する装置を自作した以上、これは選択肢ではなく義務

---

## 7. キーボードショートカット

| キー | 動作 |
|---|---|
| `Cmd+Shift+A` | **アカウント切替パレット**（fuzzy検索）★主役 |
| `Cmd+K` | コマンドパレット（`s3` → S3コンソールへジャンプ） |
| `Cmd+T` | 現在のアカウントで新規タブ |
| `Cmd+W` | タブを閉じる |
| `Cmd+1`〜`Cmd+9` | タブ切替 |
| `Cmd+Shift+[` / `]` | 前／次のタブ |
| `Cmd+Shift+T` | TOTPパネル |
| `Cmd+Opt+R` | リージョン切替 |
| `Cmd+R` | リロード |
| `Cmd+F` | ページ内検索（`webContents.findInPage`） |
| `Cmd+Opt+I` | DevTools |

---

## 8. 実装マイルストーン

| # | 内容 | 目安 |
|---|---|---|
| **M0** | **検証スパイク**（下記 §9）— device auth → GetRoleCredentials → federation でコンソールに入れるか。50行のスクリプトで足りる。**ここがNGならプロジェクト中止** | 0.5日 |
| **M1** | Electronシェル + `WebContentsView` タブ + 許可ドメイン + DevTools + `window.open` ハンドリング | 1日 |
| **M2** | SSO統合 — サイドバー、`ListAccounts`/`ListAccountRoles`、ワンクリック接続、セッション期限管理と自動再federation | 1〜1.5日 |
| **M3** | TOTP — QR取り込み、コード生成、`safeStorage`、パネル、Identity Centerへの入力補助 | 0.5〜1日 |
| **M4** | 永続化（tabs.json / config.json）、色分けガードレール、ダウンロード、ショートカット、ハイバネート | 0.5日 |
| **M5** | 仕上げ — コード署名、`electron-updater`、Finicky連携、カスタムスキーム `aws-console://` | 0.5日 |

**合計 4〜5日**（xterm.jsターミナルが2日だった前提での換算）

---

## 9. M0 検証スパイク

**最初に書くコードはこれ。** アプリのシェルより先に、認証フローが成立するかを確認する。

```ts
// spike.ts
import {
  SSOOIDCClient, RegisterClientCommand,
  StartDeviceAuthorizationCommand, CreateTokenCommand,
} from '@aws-sdk/client-sso-oidc'
import {
  SSOClient, ListAccountsCommand,
  ListAccountRolesCommand, GetRoleCredentialsCommand,
} from '@aws-sdk/client-sso'

const REGION = 'ap-northeast-1'
const START_URL = 'https://d-xxxxxxxxxx.awsapps.com/start'  // ← 自分のポータルURL

const oidc = new SSOOIDCClient({ region: REGION })

// 1. クライアント登録
const reg = await oidc.send(new RegisterClientCommand({
  clientName: 'aws-console-browser', clientType: 'public',
}))

// 2. デバイス認可の開始
const dev = await oidc.send(new StartDeviceAuthorizationCommand({
  clientId: reg.clientId, clientSecret: reg.clientSecret, startUrl: START_URL,
}))
console.log('ブラウザで開いて承認してください:\n', dev.verificationUriComplete)

// 3. 承認をポーリング
let token
while (!token) {
  await new Promise(r => setTimeout(r, (dev.interval ?? 5) * 1000))
  try {
    token = await oidc.send(new CreateTokenCommand({
      clientId: reg.clientId,
      clientSecret: reg.clientSecret,
      grantType: 'urn:ietf:params:oauth:grant-type:device_code',
      deviceCode: dev.deviceCode,
    }))
  } catch (e: any) {
    if (e.name !== 'AuthorizationPendingException') throw e
  }
}

// 4. アカウント / ロール列挙
const sso = new SSOClient({ region: REGION })
const { accountList } = await sso.send(
  new ListAccountsCommand({ accessToken: token.accessToken })
)
console.table(accountList)

const acct = accountList![0]
const { roleList } = await sso.send(new ListAccountRolesCommand({
  accessToken: token.accessToken, accountId: acct.accountId,
}))

// 5. 一時認証情報
const { roleCredentials: c } = await sso.send(new GetRoleCredentialsCommand({
  accessToken: token.accessToken,
  accountId: acct.accountId,
  roleName: roleList![0].roleName,
}))

// 6. federation エンドポイントで SigninToken を取得
const session = encodeURIComponent(JSON.stringify({
  sessionId: c!.accessKeyId,
  sessionKey: c!.secretAccessKey,
  sessionToken: c!.sessionToken,
}))
const res = await fetch(
  `https://signin.aws.amazon.com/federation?Action=getSigninToken&Session=${session}`
)
const { SigninToken } = await res.json() as { SigninToken: string }

// 7. ログインURLの組み立て（15分間有効・ワンショット）
const destination = encodeURIComponent(
  `https://${REGION}.console.aws.amazon.com/console/home?region=${REGION}`
)
const issuer = encodeURIComponent('https://localhost/aws-console-browser')
console.log(
  `\nこのURLを開けばコンソールに入れます:\n` +
  `https://signin.aws.amazon.com/federation` +
  `?Action=login&Issuer=${issuer}&Destination=${destination}&SigninToken=${SigninToken}`
)
```

### M0 で必ず確認すること

- [ ] device auth が Identity Center の設定で許可されているか
- [ ] 生成したURLでコンソールに入れるか
- [ ] **2つのアカウントのURLを、Chromeの別プロファイル（=別Cookieジャー）で同時に開けるか** ← パーティション分離の前提確認
- [ ] `SessionDuration=43200` を付けた場合にエラーになるか（なるなら省略で確定）
- [ ] コンソールセッションが実際に何時間持つか
- [ ] Identity Center が FIDO2 必須設定になっていないか（TOTP運用なら問題なし）
- [ ] **CloudShell** が Electron 内で動くか（WebSocket + xterm.js。Chromiumなので通る見込みは高いが未検証）

---

## 10. M1 スケルトン

```ts
// main.ts
import { app, BaseWindow, WebContentsView, shell, session } from 'electron'
import path from 'node:path'

const ALLOWED = [
  /^signin\.aws\.amazon\.com$/,
  /\.console\.aws\.amazon\.com$/,
  /\.awsapps\.com$/,
  /\.amazonaws\.com$/,
  /\.aws\.amazon\.com$/,
  /\.awsstatic\.com$/,
]
const isAllowed = (url: string) => {
  try { return ALLOWED.some(re => re.test(new URL(url).hostname)) }
  catch { return false }
}

app.enableSandbox()

app.whenReady().then(() => {
  const win = new BaseWindow({ width: 1600, height: 1000, titleBarStyle: 'hiddenInset' })

  const makeTab = (partition: string, url: string) => {
    const view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, 'preload-aws.js'),
      },
    })

    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowed(url)) makeTab(partition, url)   // ★同一パーティション
      else shell.openExternal(url)
      return { action: 'deny' }
    })

    view.webContents.on('will-navigate', (e, url) => {
      if (!isAllowed(url)) { e.preventDefault(); shell.openExternal(url) }
    })

    win.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 40, width: 1600, height: 960 })  // 上40pxはタブバー
    view.webContents.loadURL(url)
    return view
  }

  // ダウンロードのアカウント別振り分け
  session.fromPartition('persist:acct-123456789012-AdministratorAccess')
    .on('will-download', (_e, item) => {
      item.setSavePath(path.join(app.getPath('downloads'), 'AWS', 'prod-web', item.getFilename()))
    })

  makeTab('persist:acct-123456789012-AdministratorAccess', 'https://ap-northeast-1.console.aws.amazon.com/')
})
```

---

## 11. Finicky 連携

既存の Finicky 設定に AWS 系ドメインのルールを追加し、他アプリから開かれたAWSのURLを本アプリへ流す。

```js
// ~/.finicky.js
{
  match: [
    /console\.aws\.amazon\.com/,
    /awsapps\.com\/start/,
    /signin\.aws\.amazon\.com/,
  ],
  browser: "AWS Console Browser",
}
```

本アプリ側は `open-url` イベントとカスタムスキーム `aws-console://` を受け、URLに含まれる accountId から適切なパーティションのタブで開く。accountId が判定できない場合はアカウント選択パレットを出す。

---

## 12. リスクと未検証事項

| リスク | 影響 | 対応 |
|---|---|---|
| `GetRoleCredentials` の認証情報で `SessionDuration` が使えない | コンソールセッションが既定1時間で切れる | M0で確認。使えなければ省略し、**ロール側の max session duration を12時間に引き上げる**ことで対処 |
| federation URLが15分・ワンショット | 生成後すぐナビゲートしないと失効 | 生成→即ナビゲート。キャッシュしない設計にする |
| CloudShell が動かない | 用途が減る | M0で確認。ChromiumなのでWebSocketは通る見込み |
| Identity Center が FIDO2 必須 | WebView内のWebAuthnは不安定 | M0で確認。TOTP運用中なら影響なし |
| Chromium の CVE 追従 | セキュリティ | `electron-updater` で月次のマイナー更新を自動取り込み。**これを怠るなら作らないほうがよい** |
| 未署名だとKeychainプロンプトが毎回出る | 常用時の摩擦 | Apple Developer 証明書で署名。なければ ad-hoc 署名 + 初回許可で運用 |
| AWSがfederationエンドポイントの仕様を変更 | 認証が壊れる | 公式ドキュメント記載の長期安定した仕組みなので低リスク。純正マルチセッションへのフォールバックを残す |
| TOTPシードとコンソールの同居 | MFAの実効性低下 | §4.3のセキュリティ注意を参照。ルート/ブレークグラス用シードは入れない |

---

## 13. 参考

- AWS: Enable custom identity broker access to the AWS console（federation エンドポイントの公式手順）
- AWS: Signing in to multiple accounts（純正マルチセッション、5セッション上限）
- 参考実装として `granted`（common-fate）、`aws-vault login`、`aws_consoler` が同じ federation フローを使っている。詰まったらこれらの実装を読むのが早い
- Electron: `WebContentsView`、`session.fromPartition`、`safeStorage`、`setWindowOpenHandler`

---

## 付録: 判断の要約

| 論点 | 結論 |
|---|---|
| Electron か Tauri か | **Electron**。DevToolsとパーティション分離が1行で済むことが決定打 |
| セッション分離の方式 | **federation エンドポイント + パーティション**。純正マルチセッション（5上限）はフォールバック |
| TOTP自動入力 | **しない。** ワンクリック挿入まで。対象はIdentity Centerサインインページのみ |
| 汎用ブラウザ機能 | **作らない。** 許可ドメイン外は既定ブラウザへ委譲 |
| 「軽量化」 | **目標にしない。** 得られるのは摩擦の低減であって、メモリ使用量の削減ではない |
| 最初に書くコード | **M0スパイク。** シェルより先に認証フローの成立を確認する |
