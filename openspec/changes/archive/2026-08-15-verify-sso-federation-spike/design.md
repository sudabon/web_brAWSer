## Context

リポジトリは空（README / LICENSE / 仕様書のみ）で、まだコードは存在しない。本 change はプロジェクト最初のコードであり、同時に**継続判断のゲート**である。

解決したい業務課題は、IAM Identity Center 配下の多数アカウントを扱う際の (1) タブの氾濫、(2) アカウント切替の摩擦、(3) 同一ドメイン Cookie 共有によるセッション衝突、である。このうち (3) の解法として、AWS 純正マルチセッション（5セッション上限）ではなく **federation エンドポイント + パーティション分離**を採る。この方式の成立可否がプロジェクト全体の前提になる。

実測が必要な未知が複数ある（`SessionDuration` の可否、コンソールセッションの実持続時間、Identity Center 側の device auth 許可設定、FIDO2 必須設定の有無、CloudShell の動作）。これらを Electron シェルの実装より先に潰す。

## Goals / Non-Goals

**Goals:**

- `RegisterClient` → `StartDeviceAuthorization` → `CreateToken` → `ListAccounts` / `ListAccountRoles` → `GetRoleCredentials` → `getSigninToken` → login URL の一気通貫の成立を実証する
- **2アカウント以上を別Cookieジャーで同時にサインイン状態にできること**を実測する（パーティション分離という設計全体の前提）
- `SessionDuration` の可否とコンソールセッションの実持続時間を数値で確定する
- 後続マイルストーンでそのまま使える Electron 非依存のモジュールを残す
- NG の場合に「中止」と判断できる材料を文書として残す

**Non-Goals:**

- Electron の起動、ウィンドウ、タブ、UI（`electron-app-shell` の担当）
- トークンの永続化、`safeStorage` 暗号化（`sso-account-directory` の担当）
- 例外系の網羅的なハンドリング（スパイクは正常系＋主要な失敗の識別で足りる）
- 自動テスト。本 change の検証は実 AWS 環境に対する人手の確認である

## Decisions

### D1: federation エンドポイント方式を採り、純正マルチセッションはフォールバックに留める

AWS 純正マルチセッションは、アカウントメニューから opt-in すると最大5つのアイデンティティに同一ブラウザで同時サインインでき、各セッションが `<accountId>-<hash>.<region>.console.aws.amazon.com` のサブドメインを持つ。実装は圧倒的に楽（ただのブラウザで済む）。

**不採用の理由**: 5セッション上限が本件の課題（多数アカウント）をそのまま残す。加えて opt-in が必要でブックマーク URL が変わり、一部サービス（Marketplace 等）でサブドメインが落ちる不具合報告がある。

ただし本 change の検証が NG だった場合の**フォールバック候補として明示的に残す**。

### D2: `SessionDuration` はまず省略する

公式ドキュメント上、`SessionDuration` は `AssumeRole*` 系で取得した認証情報の場合にのみ付与でき、最大43200秒（12時間）。`sso:GetRoleCredentials` の認証情報で受け付けられるかは不明であり、**実測が必要**。

まず省略した実装で成立を確認し、`SessionDuration=43200` を付けた場合にエラーになるかを別途1回だけ試す。セッション長を伸ばしたい場合は `SessionDuration` に頼るより**ロール側の max session duration を12時間に引き上げる**ほうが確実である（`SessionDuration` はロールの最大セッション長以上には指定できない）。

### D3: `getSigninToken` は POST を使う

`getSigninToken` は GET・POST どちらも受け付ける。GET では一時認証情報が URL に載る。ローカルからの通信であり実害は小さいが、シェル履歴やプロセス一覧への露出を避けるため POST を既定とする。仕様書のサンプルコードは GET だが、本実装では POST に変更する。

### D4: Electron 非依存の純関数として実装する

スパイクを使い捨てにせず、`sso-account-directory` の `FederationService` がそのまま呼べる形にする。Electron API・ファイルI/O・グローバル状態に依存させず、引数と戻り値だけで完結させる。これによりスパイクの検証結果がそのまま本体の動作保証になる。

### D5: 秘密情報を一切出力しない

スパイクは検証用だが、`accessKeyId` / `secretAccessKey` / `sessionToken` / `clientSecret` / `SigninToken` をコンソールにも `RESULTS.md` にも出さない。`console.table(accountList)` のようなアカウント一覧の表示は可。ログイン URL は SigninToken を含むため、**表示はするが記録しない**（人手で開くために必要なため表示は避けられない。使用後15分で失効する）。

### D6: 検証は人手のチェックリストで行う

実 AWS 環境・実ブラウザ・実 MFA を伴うため自動テスト化しない。`spike/RESULTS.md` にチェックリストと実測値を残し、これを後続 change の入力とする。

## Risks / Trade-offs

| リスク | 影響 | 緩和 |
|---|---|---|
| Identity Center 側で device auth が許可されていない | フロー全体が成立しない | 本 change の最初の確認項目にする。管理者設定で有効化できるか確認し、不可なら D1 のフォールバックへ |
| `GetRoleCredentials` の認証情報で `SessionDuration` が使えない | コンソールセッションが既定（1時間程度）で切れる | 省略で確定し、ロール側 max session duration を12時間へ引き上げて対処。無言再federation（`console-session-lifecycle`）が実装されれば運用上の影響は小さい |
| federation URL が15分・ワンショット | 生成後すぐ使わないと失効 | 生成→即使用。保存・キャッシュしない設計を仕様に固定する |
| 別Cookieジャーでの同時サインインが成立しない | 設計の中核前提が崩れる | 本 change の中止判断項目。NG なら純正マルチセッションへ切り替え、スコープを5アカウントに縮小して再検討 |
| Identity Center が FIDO2 必須設定 | WebView 内の WebAuthn は挙動が不安定で、内蔵TOTP方針と噛み合わない | 確認項目に含める。TOTP 運用中なら影響なし。FIDO2 必須なら `builtin-totp` の前提を見直す |
| CloudShell が動かない | 用途が減る（中止事由ではない） | 確認項目に含める。Chromium なので WebSocket は通る見込み |
| AWS が federation エンドポイントの仕様を変更 | 認証が壊れる | 公式ドキュメント記載の長期安定した仕組みであり低リスク。`granted` / `aws-vault login` / `aws_consoler` が同じフローを使っており、詰まったらこれらの実装を参照する |

## Migration Plan

新規プロジェクトのため移行対象はない。本 change の成果物は後続 change に取り込まれ、`spike/` ディレクトリは `sso-account-directory` 完了時に本体へ吸収するか、検証用として残すかを判断する。

## Open Questions

- 検証に使う Identity Center ポータル URL（`startUrl`）とリージョン — 実行時に利用者が指定する
- ロール側の max session duration の現行値と、引き上げ権限を持っているか
- 検証に使えるアカウントが2つ以上あるか（パーティション分離の検証に必須）
