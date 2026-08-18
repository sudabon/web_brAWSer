# 配布・署名・自動更新

WEBbrAWSer は Chromium を内蔵するため、自動更新を無効化した構成は配布しない。バージョンは **SemVer**（`MAJOR.MINOR.PATCH`）で、`package.json` の `version` が唯一のソースである。

更新フィードは **GitHub Releases**（`https://github.com/sudabon/web_brAWSer`）を使う。問い合わせは HTTPS のみ。

## パッケージング

```sh
pnpm run package        # .app + dmg + zip（arm64 / x64）
pnpm run package:dir    # Apple Silicon 向け .app のみ（検証用）
```

成果物は `dist/` に出力される。`package:dir` の `.app` は `dist/mac-arm64/WEBbrAWSer.app`。`zip` は `electron-updater` が取得する更新パッケージである。

バンドル ID は `com.sudabon.web-brawser`、プロダクト名は `WEBbrAWSer`。

## コード署名

このマシンに Apple Developer 証明書が無い場合、`electron-builder.yml` の `mac.identity: "-"` により **ad-hoc 署名** する。

### ad-hoc 署名の制約

- Developer ID が無いため Hardened Runtime は無効にする。有効のままだと Gatekeeper が Finder からの起動を `rejected` し、Dock が跳ねて終わる。
- 初回は右クリック → 開く、または `open dist/mac-arm64/WEBbrAWSer.app`。システム設定 → プライバシーとセキュリティ から許可する場合もある。
- 公証（notarization）は行わない。他マシンへ配布すると、警告や実行ブロックが出やすい。
- Keychain プロンプトは、初回許可後は毎回は出ない想定。未署名よりは常用に耐えるが、Developer ID よりは弱い。

### Apple Developer 証明書がある場合

1. `electron-builder.yml` の `mac.identity` を削除するか、`Developer ID Application: ...` に置き換える。
2. `mac.notarize` を有効化し、環境変数 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` を設定する。
3. `CSC_LINK` と `CSC_KEY_PASSWORD`（またはログインキーチェーンの証明書）で署名する。

## 署名変更と safeStorage

Electron の `safeStorage` は macOS では Keychain 由来の鍵を使い、アプリのコード署名 ID に紐づく。

**実測:** 本環境には Developer ID が無く（`security find-identity -v -p codesigning` が 0 件）、ad-hoc 同士の比較しかできない。Electron の仕様上、ad-hoc から Developer ID へ切り替えると Keychain 項目が別物になり、`sso.enc` / `totp.enc` の復号に失敗する可能性が高い。移行時は復号不能を前提にする。

### ad-hoc から正式署名へ移るときの再インポート

1. 旧（ad-hoc）アプリで TOTP シードを 1Password 等へ退避する。SSO はポータルから再認証できるので、トークンのエクスポートは不要。
2. 旧アプリを終了する。
3. 正式署名の `.app` を入れ替える。
4. 初回起動後、SSO を再認証する（`sso.enc` が読めなければ signed-out になる）。
5. TOTP を再インポートする（`totp.enc` が読めなければ空のストアとして扱う）。
6. 復号に失敗した古い `sso.enc` / `totp.enc` は残しても使われない。問題なければ削除してよい。

## 自動更新

パッケージ済みアプリは起動時に GitHub Releases を確認する。

- 更新パッケージのコード署名が検証される。検証失敗時は適用しない（`quitAndInstall` は呼ばない）。
- ダウンロードした更新は **次回終了〜起動時** に適用する。作業中に再起動を強制しない。
- フィード到達失敗時は現行バージョンで動作を継続し、`auto-update failed` を記録する。

開発中（未パッケージ）は更新チェックを行わない。無効化スイッチは配布物に付けない。

### ロールバック

1. GitHub Releases から一つ前の `zip` / `dmg` を入手する。
2. アプリを終了し、`/Applications/WEBbrAWSer.app` をそのバージョンで置き換える。
3. 起動してバージョン（`package.json` / About）を確認する。
4. 署名 ID が変わっていなければ `safeStorage` のデータはそのまま使える。変わっていれば上記の再インポートを行う。
5. 壊れた更新キャッシュが残る場合は `~/Library/Application Support/web-brawser/` 配下の updater キャッシュを削除する（`sso.enc` / `totp.enc` / 設定は消さない）。

## 検証メモ（実装時）

- Apple Silicon 向け `.app` は `npm run package` で生成する。
- 署名検証失敗やフィード遮断はユニットテスト（`AutoUpdate.test.ts`）と、実機ではネットワーク遮断 + 改ざん zip で確認する。
