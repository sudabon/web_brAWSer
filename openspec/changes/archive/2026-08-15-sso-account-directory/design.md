## Context

`verify-sso-federation-spike` で実証した認証フローと、`electron-app-shell` で用意した器を接続する change。ここで本アプリの主役機能が完成する。

設計上の核心は**二層モデル**にある。従来のブラウザは「タブ」という単一の平面にすべてを並べるため、40アカウント扱えばタブは氾濫する。本アプリは `アカウント → タブ` の二層にし、アカウント一覧をサイドパネル（タブを消費しない）、タブを「現在のアカウントに属するもののみ」に限定する。40タブ開いていても視界には3〜4タブしか出ない。これがタブ氾濫の解決策そのものである。

`electron-app-shell` の D9 でタブを左サイドパネルの縦型リストに配置すると決めたため、この二層はパネル内で上下に積まれる。上部のアカウントセクションが第1層、下部のタブセクションが第2層であり、構造と見た目が一致する。

## Goals / Non-Goals

**Goals:**

- SSO セッションの確立をアプリ内で完結させ、MFA 入力を1日1回程度に抑える
- アカウント×ロール一覧をサイドバーとして持ち、タブと切り離す
- ワンクリック（`Cmd+Shift+A` からは2キーストローク）でアカウントを切り替える
- 認証情報の有効期限を可視化し、切れたら無言で回復する
- 一時認証情報をメインプロセスのメモリから外に出さない

**Non-Goals:**

- TOTP の生成・入力補助（`builtin-totp`）。この change の時点では MFA コードは外部（既存の Authenticator）から手入力する
- タブの永続化・ハイバネート（`workspace-persistence-guardrails`）
- アカウント色の注入（`workspace-persistence-guardrails`）。この change では色の**設定と保存**までを担う
- `SessionDuration` による意図的なセッション延長

## Decisions

### D1: SSO セッションはアプリ内の専用パーティション `persist:sso-portal` で確立する

`verificationUriComplete` を外部ブラウザで開くとアプリ外に出てしまい、`builtin-totp` の入力補助も効かなくなる。アプリ内の専用パーティションで開くことで、サインインからトークン取得までがアプリ内で完結する。

このパーティションはアカウント用パーティションとは完全に分離する。ポータルの Cookie が個々のコンソールセッションに混ざらないようにするためである。

### D2: SSO 状態は `safeStorage` で暗号化し `sso.enc` に保存する

`accessToken` は既定8時間（Identity Center のセッション設定に依存）。再起動のたびに MFA を求めるのは常用に耐えないため永続化する。平文保存は論外なので `safeStorage`（macOS では Keychain 由来の鍵）を使う。

保存対象は `startUrl` / `region` / クライアント登録（`clientId` / `clientSecret` / 有効期限）/ `accessToken` / `refreshToken` / 失効時刻。**一時認証情報は保存しない。**

### D3: トークン失効時の回復は3段階にする

1. `refreshToken` があれば更新を試す（利用者操作なし）
2. 失敗したら device authorization をやり直す（MFA 入力1回）
3. クライアント登録が失効（約90日）していれば `RegisterClient` からやり直す

段階を分けることで、日常的には利用者操作ゼロで回復できる。

### D4: 期限切れタブは無言で再federationする

`GetRoleCredentials` の認証情報は短命な可能性が高い（`SessionDuration` の可否は `verify-sso-federation-spike` の実測に従う）。期限切れのたびに利用者に再ログインを求めるのは本アプリの目的に反する。

SSO `accessToken` が生きていれば、`GetRoleCredentials` → `getSigninToken` → login URL 生成を無言で再実行し、`Destination` に**直前の URL** を指定してナビゲートする。利用者には一瞬のリロードにしか見えない。

これにより D3 の「`SessionDuration` に頼らない」という判断が運用上成立する。

### D5: サイドバーには接続状態と有効期限のみを IPC で渡す

一時認証情報をレンダラに渡すと、レンダラ側の脆弱性が即座に認証情報漏洩になる。IPC で渡すのは「接続中か」「いつまで有効か」だけにする。federation URL の生成とナビゲート指示はメインプロセス内で完結させる。

### D6: 一覧はキャッシュし、起動時は API を待たない

`ListAccounts` / `ListAccountRoles` はアカウント数に比例して時間がかかる（アカウントごとに `ListAccountRoles` が1回）。起動のたびに待たせないよう、結果を `config.json` にキャッシュし、起動時はキャッシュで即描画してからバックグラウンドで更新する。手動リフレッシュも提供する。

### D7: 切替パレットを主役の導線にする

`Cmd+Shift+A` → 数文字入力 → Enter でアカウントが切り替わる。サイドバーのクリックより速く、アカウント数が増えても劣化しない。fuzzy 検索は `fuse.js` 等の既製ライブラリを使い、`accountName` / `accountId` / `roleName` を検索対象にする。

### D8: パーティション名は `persist:acct-<accountId>-<roleName>` に固定する

`electron-app-shell` で決めた命名規則をここで実際に供給する。`accountRoleKey` は `${accountId}#${roleName}` とし、パーティション名とは別に持つ（キーはデータ構造の識別子、パーティション名は Electron への文字列）。

`roleName` にパーティション名として不正な文字が含まれる可能性は低いが、生成をヘルパ関数に集約してサニタイズする余地を残す。

## Risks / Trade-offs

| リスク | 影響 | 緩和 |
|---|---|---|
| `accessToken` が `sso.enc` から漏れる | 全アカウントへのアクセスが可能になる | `safeStorage` 暗号化。加えて未署名アプリでは Keychain プロンプトが毎回出るため、`packaging-and-url-handoff` で署名する |
| 一時認証情報がレンダラへ漏れる | 認証情報漏洩 | D5 の IPC 契約を守る。IPC のペイロード型を明示し、認証情報を含む型をレンダラ側に export しない |
| アカウント数が多いと一覧取得が遅い | 起動が遅い | D6 のキャッシュ。`ListAccountRoles` は並列実行し、レート制限に応じて同時実行数を絞る |
| 無言再federationが無限ループする | UIが固まる | 再試行回数に上限を設け、超えたら利用者に再認証を求める |
| `Destination` に直前URLを指定して復帰できない | 復帰先がコンソールホームになる | 実装時に確認。最低限ホームに戻れば作業は継続できる |
| 純正マルチセッションへのフォールバックが必要になる | 設計変更 | `verify-sso-federation-spike` で判断済みの前提。この change の着手時点で解消している |

## Migration Plan

`verify-sso-federation-spike` の `spike/federation-spike.ts` から Electron 非依存の関数群を `src/main/FederationService.ts` へ移す。スパイクは検証用として残すか削除するかを実装時に判断する。

`electron-app-shell` でハードコードしていたパーティション名を、`SessionManager` からの供給に置き換える。

## Open Questions

- `refreshToken` が Identity Center の設定で発行されるか — 実行時に判明する。発行されない場合は device authorization のやり直しのみになる
- 無言再federation の発火条件 — 「タブ操作時」か「期限監視のタイマー」か。前者のほうが無駄な API 呼び出しが少ない
- アカウント色の自動割当アルゴリズム — 実装時に決める（ハッシュベースか、順番に固定パレットから割り当てるか）
