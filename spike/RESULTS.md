# SSO federation スパイク検証結果

日時: 2026-08-15  
環境: macOS / Chrome（隔離プロファイル） / IAM Identity Center `d-9567941301` / リージョン `ap-northeast-1`

**継続判断: GO**

4.2（生成URLでコンソールに入れる）と 4.3（2アカウントを別 Cookie ジャーで同時に開ける）はどちらも成立した。`electron-app-shell` に着手してよい。

## 4. 検証チェックリスト

| 項目 | 結果 |
|---|---|
| 4.1 device auth が Identity Center で許可されているか | **許可されている。** `RegisterClient` → `StartDeviceAuthorization` → `CreateToken` が一気通貫で成功した。 |
| 4.2 生成URLでコンソールに入れるか | **入れる。** 人手確認済み。 |
| 4.3 2アカウントを別 Cookie ジャーで同時に開けるか | **開ける。** Enjin と recordati-dev を `~/.acb-test/enjin` と `~/.acb-test/recordati-dev` で同時表示できた。Identity Center 上は 3 アカウント（Enjin / recordati-dev / projectb-dev）。 |
| 4.4 `SessionDuration=43200` でエラーになるか | **エラーにならない。** `getSigninToken` に `SessionDuration=43200` を付けても SigninToken が返った。コンソール寿命が 12 時間になるかは未証明。許可セットは 4 時間なので、実セッションはそちらに頭打ちされる見込み。 |
| 4.5 コンソールセッションの実測持続時間 | **切断時刻は未観測。** 接続開始 2026-08-15 13:28 JST。使用ロールの許可セットは PT4H。admin プロファイルの一時認証情報期限は 2026-08-15 17:30 JST（約4時間）。実切は後続で追記する。 |
| 4.6 FIDO2 必須設定か | **FIDO2 専用必須ではない。** MFA 自体は必須。利用者確認では TOTP。device auth 時に WebAuthn プロンプトは観測していない。`builtin-totp` 方針と両立する。 |
| 4.7 CloudShell が Chromium 上で動作するか | **動作する。** Enjin の隔離 Chrome で CloudShell のターミナルが表示された。 |
| 4.8 秘密情報が残っていないか | **成果物ファイルには書いていない。** `spike/*.local.*` なし。ソースに SigninToken / 一時認証情報の値なし。ログインURLは標準出力のみ。隔離 Chrome の `~/.acb-test/` にはコンソール Cookie が残る（検証用。不要なら削除）。Cursor の会話ログに標準出力が残る可能性があるため、`.specstory/` 等はコミットしない。 |

## 5.2 ロール側の max session duration

検証に使った許可セット:

| Permission set | SessionDuration | 用途 |
|---|---|---|
| ManagementAdministrator | PT4H | Enjin |
| TenantAdministrator | PT4H | recordati-dev |

Enjin（管理アカウント）の IAM ロール `AWSReservedSSO_ManagementAdministrator_*` の `MaxSessionDuration` は **43200 秒（12時間）**。許可セットの 4 時間が短い側の制約。

引き上げ可否: 管理アカウントの Identity Center 管理者なら、許可セットのセッション長を最大 12 時間まで上げられる（IAM ロール側は既に 12 時間）。コンソールを長くしたい場合は `SessionDuration` クエリパラメータより、許可セット側を上げる方が確実。

## 5.3 フォールバック

4.2 / 4.3 は成功したため、純正マルチセッション（5セッション上限）へのフォールバックは不要。

## 5.4 継続判断

**GO**

後続は `electron-app-shell`。federation コアは `spike/federation.ts` をそのまま再利用する。`SessionDuration` は省略を既定とし、セッション長は許可セット（現状 4 時間）に合わせる。
