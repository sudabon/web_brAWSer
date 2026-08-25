## Context

`TotpStore.unlock()` は `safeStorage.decryptString()` の例外を catch し、メッセージを `#error` に格納して `false` を返す（`src/main/TotpStore.ts:75-86`）。呼び出し側の `#importDrafts()` / `copy()` / `currentCodeForAssist()` は `unlock()` が false ならそのメッセージを throw する。`#persist()` は `#importDrafts()` の内側にしかないため、**復号に失敗している間は新しい鍵で書き直す経路が存在しない**。これが「一度壊れると UI から復旧できない」構造の原因である。

今回の実測結果（Electron の `safeStorage` で直接検証）:

| ファイル | 旧鍵 `web-brawser Safe Storage` | 現行鍵 `WEBbrAWSer Safe Storage` |
|---|---|---|
| `web-brawser/totp.enc`（2026-08-18 11:45） | 復号成功 | 失敗 |
| `web-brawser/creds.enc`（2026-08-26 06:08） | 失敗 | 復号成功 |
| `web-brawser/sso.enc`（2026-08-18 19:00） | 失敗 | 復号成功 |

Keychain の項目作成日時は `web-brawser Safe Storage` が 2026-08-15、`WEBbrAWSer Safe Storage` が 2026-08-18 15:36（パッケージ版の初回起動時刻）。`productName` 導入と `app.setPath("userData", ...)` による userData 固定（`src/main/main.ts:63-64`）が同日 15:41 の初回コミットに含まれており、鍵名だけが変わってフォルダは据え置かれた事実と一致する。

制約:

- safeStorage の鍵は Keychain のサービス名（`app.getName()` 由来）に固定され、アプリ側から鍵を選択できない
- `CredentialStore` / `SsoManager` も同じ「復号失敗で詰む」構造だが、現行鍵で復号できており実害がないため本変更では触らない
- 既存の `TotpStore` テストはメモリ上の fake fs で動作しており、`node:fs` を直接呼ぶ実装はテスト不能になる

## Goals / Non-Goals

**Goals:**

- 復号失敗を恒久的な行き止まりにせず、利用者の操作だけで TOTP 機能を使える状態へ戻せるようにする
- 復号失敗（鍵の不一致・Keychain 障害）と解錠拒否（認証キャンセル）を状態として区別し、提示するメッセージを変える
- 一時的な障害でシードを黙って失わないことを保証する

**Non-Goals:**

- 旧鍵で暗号化された既存データの移行・救済
- 暗号化ファイルへの鍵識別子の埋め込みと鍵名変更をまたぐ自動移行
- `CredentialStore` / `SsoManager` への同等の導線追加
- `productName` および userData パスの変更

## Decisions

### D1: `locked` とは別に `unreadable` 状態を持つ

`TotpSnapshot` に `unreadable: boolean` を追加し、復号失敗時は `locked: true` かつ `unreadable: true` とする。

- **理由**: `locked` だけでは「認証すれば直る」と誤解させる。UI が提示すべき文言も操作も異なる
- **代替案**: `errorMessage` の文字列で UI が判定する → 文言変更で壊れる暗黙の契約になるため却下

### D2: 復号失敗時に自動リセットしない

- **理由**: `decryptString()` の失敗は鍵名の変更以外に Keychain のロックやアクセス拒否でも起こる。自動で空にして上書きすると、一時障害で MFA シードを恒久的に失う。再登録には各サービスでの MFA 再設定が必要であり、損失が大きすぎる
- **代替案**: 復号失敗時に空のシード一覧で自動解錠し、次の書き込みで上書き → 実装は最小だが上記の理由で却下

### D3: リセットは削除ではなく退避

`totp.enc` を `totp.enc.bak.<epoch millis>` へリネームする。

- **理由**: 誤操作および D2 で想定した一時障害の取り違えに対する救済余地を残す。タイムスタンプ付きで複数回のリセットが衝突しない
- **代替案**: `unlink` → 復旧手段が消えるため却下

### D4: 退避操作は `renameFile(from, to)` として注入する

`TotpStoreOptions` に `renameFile: (from: string, to: string) => Promise<void>` を追加し、`main.ts` で `node:fs/promises` の `rename` を渡す。

- **理由**: 既存の `readFile` / `writeFile` と同じ注入方針を守り、テストをメモリ上の fake fs のまま維持する

### D5: `reset()` は Touch ID を要求しない

代わりに (a) `unreadable` のときのみ受け付けるガードを `TotpStore.reset()` に置き、(b) 主プロセスの `totp:reset` ハンドラで `dialog.showMessageBox` による確認を求める（`unlockGate` のフォールバックと同じ流儀）。

- **理由**: 復号不能状態では保護すべき平文がメモリにもファイルにも存在しない。また Keychain 障害時は認証も通らない可能性があり、Touch ID を必須にすると「認証できないからリセットもできない」という同じ詰みを再発させる
- **ガードの必要性**: IPC は任意の webContents から呼べるため、正常時の `reset()` を無条件に受け付けると保存済みシードを消す経路になる。`unreadable` 限定にすることで、破壊できる対象を「そもそも復号できないファイル」に限定する

### D6: `unlock()` の復号失敗経路

`#seeds` は空のまま、`#seedCount = 0`、`#locked = true`、`#unreadable = true` を立て、`#error` に原因と対処を含むメッセージを設定して `false` を返す。復号に成功した経路では常に `#unreadable = false` に戻す。

- **理由**: 復号できていない以上メモリに載せるものはなく、`locked` を維持することで「コードは表示されない」という既存の不変条件を保つ

### D7: `reset()` 成功後の状態

`#seeds = []`、`#seedCount = 0`、`#locked = false`、`#unreadable = false`、`#error = undefined`。`totp.enc` は書き込まない（次のインポート時に `#persist()` が現行鍵で新規作成する）。

- **理由**: リセット直後に空配列を書き込むと、退避したファイルとは別に「空の正常ファイル」が生まれる。書き込みを遅らせれば、リセット後に何も登録しないまま終了した場合の状態が「ファイルなし」に揃う

## Risks / Trade-offs

- **リセットの誤用で有効なシードを失う** → 復号不能時のみ提示・確認ダイアログ・退避ファイルの三重で緩和する。退避ファイルは削除しない
- **`totp:reset` の IPC が意図しない webContents から呼ばれる** → D5 のガードにより、正常に復号できている状態では no-op になる。TOTP コード自体を返す `totp:current-code` と異なり、リセットは値を返さないため情報漏洩の経路にはならない
- **同種の事故が `creds.enc` / `sso.enc` で再発する** → 本変更では対象外。鍵名変更をまたぐ耐性は別変更として起票する
- **退避ファイルが際限なく増える** → 実運用でリセットが繰り返される状況は想定しにくいため、世代管理は入れない

## Migration Plan

1. 本変更を適用したビルドを起動する。TOTP パネルは復号不能状態を提示する
2. 利用者が「リセットして再登録」を実行し、既存 `totp.enc` を退避する
3. QR コード画像のドラッグ＆ドロップでシードを登録し直し、コードが表示されることを確認する
4. **ロールバック**: 本変更は `totp.enc` の保存形式を変更しないため、revert しても再登録済みのシードはそのまま読める。退避ファイルは手動で削除する

## Open Questions

なし。
