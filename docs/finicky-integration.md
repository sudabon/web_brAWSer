# Finicky 連携

Slack やドキュメントから開かれた AWS の URL を、既定ブラウザではなく WEBbrAWSer へ流すための設定例です。

Finicky は URL ごとに開くアプリを選ぶ macOS 用のルータです。本アプリは `https://` 全体の既定ブラウザにはなりません。ホスト単位の振り分けは Finicky（または同様のセレクタ）に任せます。

## 本アプリ側の準備

1. パッケージ済みの `WEBbrAWSer.app` を `/Applications` に置く。
2. アプリを一度起動する。カスタムスキーム `aws-console://` が OS に登録される。
3. サイドパネルの「AWS URL の受け取りを登録」、またはメニュー **Help → AWS URL の受け取りを設定…** でも再登録できる。

開発中（`npm run dev`）でも `aws-console://` は登録されるが、パスが変わるため配布用 `.app` での運用を推奨する。

## Finicky ルール例

次のホストだけを本アプリへ流す。`docs.aws.amazon.com` はドキュメント閲覧用に既定ブラウザへ残す。

```js
export default {
  defaultBrowser: "Safari",
  handlers: [
    {
      match: [
        "console.aws.amazon.com/*",
        "*.console.aws.amazon.com/*",
        "signin.aws.amazon.com/*",
        "*.signin.aws.amazon.com/*",
        "*.awsapps.com/start*",
        "signin.aws/*",
        "*.signin.aws/*",
      ],
      browser: "WEBbrAWSer",
    },
  ],
};
```

アプリ名が解決されない場合はバンドル ID を指定する。

```js
browser: {
  name: "WEBbrAWSer",
  bundleId: "com.sudabon.web-brawser",
}
```

## カスタムスキームで明示的に渡す

Finicky や他アプリから `https://` ではなく専用スキームで渡す場合:

```
aws-console://ap-northeast-1.console.aws.amazon.com/s3/home
aws-console://open?url=https%3A%2F%2Fap-northeast-1.console.aws.amazon.com%2Fs3%2Fhome
```

どちらもアプリ内で `https://` に正規化したうえで、許可ドメインガードを通す。許可外はタブで開かず既定ブラウザへ返す。

## アカウントの選び方

- URL に既知の 12 桁 `accountId` が 1 ロールだけ紐づく場合、そのパーティションのタブで開く（未接続なら先に接続する）。
- `accountId` が無い、未知、または同一アカウントに複数ロールがある場合は、推測せずアカウント選択パレットを出す。

## 既定ハンドラとして登録する手順

macOS はホスト単位の既定アプリを持たない。できることは次の 2 つ。

1. **`aws-console://` のハンドラ** — 本アプリが登録する。他アプリからこのスキームで開けば必ず本アプリに届く。
2. **AWS 系 `https://` の振り分け** — Finicky のルールで `WEBbrAWSer` を指定する。システムの「デフォルトブラウザ」を本アプリにしないこと。全 `https://` を吸い込む。

Slack のリンクを試す手順:

1. Finicky を起動し、上記ルールを保存する。
2. Slack で `https://ap-northeast-1.console.aws.amazon.com/` のリンクを開く。
3. WEBbrAWSer の既存ウィンドウにタブが追加される（未起動なら起動後に開く）。
