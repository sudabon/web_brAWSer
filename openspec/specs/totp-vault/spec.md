# totp-vault Specification

## Purpose
TBD - created by archiving change builtin-totp. Update Purpose after archive.
## Requirements
### Requirement: TOTP シードの暗号化保管

システムは TOTP シードを `safeStorage.encryptString()` で暗号化し、`totp.enc` に保存しなければならない (SHALL)。シードを平文でディスクに書き込んではならない (MUST NOT)。

#### Scenario: シードの保存

- **WHEN** 新しいシードがインポートされる
- **THEN** シード一覧全体が JSON 化・暗号化され `totp.enc` に書き込まれる

#### Scenario: 平文の非保存

- **WHEN** アプリのデータディレクトリを検査する
- **THEN** Base32 シークレットが平文で現れるファイルは存在しない

#### Scenario: safeStorage が利用できない場合

- **WHEN** `safeStorage.isEncryptionAvailable()` が false を返す
- **THEN** シードを保存せず、暗号化が利用できない旨を利用者に提示する

### Requirement: Touch ID による解錠ゲート

システムは起動後の初回参照時に Touch ID による解錠を要求しなければならない (SHALL)。解錠後はメモリ上に保持し、スリープ復帰時に再ロックしなければならない (SHALL)。

#### Scenario: 初回参照時の解錠

- **WHEN** 起動後に初めて TOTP パネルを開く
- **THEN** `systemPreferences.promptTouchID()` が呼ばれ、成功した場合のみシードが復号される

#### Scenario: 解錠の拒否

- **WHEN** 利用者が Touch ID 認証をキャンセルまたは失敗する
- **THEN** シードは復号されず、コードは表示されない

#### Scenario: スリープ復帰時の再ロック

- **WHEN** システムがスリープから復帰する
- **THEN** メモリ上の復号済みシードが破棄され、次回参照時に再び解錠が要求される

### Requirement: QR コードの画面範囲選択インポート

システムは画面上の QR コードを範囲選択で取り込み、デコードしてシードとして登録できなければならない (SHALL)。

#### Scenario: 範囲選択からの登録

- **WHEN** 利用者が QR 取り込みを実行して画面範囲を選択する
- **THEN** `screencapture -i` で取得した PNG が `zxing-wasm` でデコードされ、`otpauth://` URI が解析されてシードが登録される

#### Scenario: デコード失敗

- **WHEN** 選択範囲に QR コードが含まれない、またはデコードできない
- **THEN** 登録は行われず、失敗が利用者に提示される

#### Scenario: 一時ファイルの破棄

- **WHEN** デコード処理が完了する
- **THEN** `screencapture` が生成した一時 PNG が削除される

### Requirement: 複数経路からのシードインポート

システムは QR 範囲選択に加え、画像ファイルのドラッグ&ドロップ、`otpauth://` URI の貼り付け、Base32 シークレットの直接入力、Chrome 拡張 Authenticator のバックアップ JSON インポートに対応しなければならない (SHALL)。

#### Scenario: 画像ファイルからの登録

- **WHEN** QR を含む画像ファイルが TOTP パネルにドロップされる
- **THEN** 画像がデコードされ、シードが登録される

#### Scenario: otpauth URI の貼り付け

- **WHEN** `otpauth://totp/{issuer}:{label}?secret=BASE32&issuer=...` 形式の URI が貼り付けられる
- **THEN** `issuer` / `label` / `secret` が抽出され、`algorithm` / `digits` / `period` は省略時に既定値 SHA1 / 6 / 30 が適用される

#### Scenario: Base32 の直接入力

- **WHEN** 利用者が発行元・ラベル・Base32 シークレットを手入力する
- **THEN** 既定パラメータ（SHA1 / 6 / 30）でシードが登録される

#### Scenario: Authenticator バックアップの取り込み

- **WHEN** Chrome 拡張 Authenticator のバックアップ JSON が読み込まれる
- **THEN** 含まれるすべてのシードが一括で登録される

#### Scenario: 不正な入力

- **WHEN** Base32 として不正な文字列が入力される
- **THEN** 登録は行われず、入力が不正である旨が提示される

### Requirement: 高権限シードの持ち込み禁止方針

本アプリは第1要素（コンソールを開く手段）と第2要素（TOTP シード）を同一プロセスに同居させるため、ルートアカウントおよびブレークグラス用のシードを登録対象としてはならない (MUST NOT)。

#### Scenario: 登録時の警告表示

- **WHEN** 利用者がシードのインポート画面を開く
- **THEN** ルートアカウントおよびブレークグラス用シードを登録しない方針が明示される

### Requirement: 復号不能状態の提示

システムは保存済みシードの復号に失敗した場合、解錠の拒否（認証のキャンセル・失敗）と区別できる「復号不能」状態を保持しなければならない (SHALL)。復号不能状態では、原因と対処（リセットして再登録できること）を利用者に提示しなければならない (SHALL)。復号に失敗したシードファイルを自動的に破棄または上書きしてはならない (MUST NOT)。

#### Scenario: 復号失敗時の提示

- **WHEN** 保存済みの `totp.enc` に対する `safeStorage.decryptString()` が例外を投げる
- **THEN** コードは表示されず、復号できないこと・リセットして再登録できることが利用者に提示される

#### Scenario: 認証キャンセルとの区別

- **WHEN** 利用者が Touch ID 認証をキャンセルする
- **THEN** 復号不能状態にはならず、リセット操作は提示されないまま再度の解錠を試みられる

#### Scenario: シードの自動破棄の禁止

- **WHEN** 復号が失敗する
- **THEN** `totp.enc` は削除も上書きもされず、内容が保持される

#### Scenario: 一時障害からの自然回復

- **WHEN** 復号失敗の後、暗号鍵が再び利用可能な状態で解錠し直す
- **THEN** 既存のシードがそのまま復号され、復号不能状態は解除される

#### Scenario: 復号不能状態でのインポート

- **WHEN** 復号不能状態でシードのインポート（URI・手入力・バックアップ JSON・QR 画像・画面範囲選択）が実行される
- **THEN** インポートは行われず、復号できないこと・リセットが必要であることが提示される

### Requirement: 利用者による TOTP ボールトのリセット

システムは復号不能状態のときに限り、利用者が明示的に実行できるリセット操作を提供しなければならない (SHALL)。リセットは既存の `totp.enc` を退避したうえで、空のシード一覧を解錠済みとして扱わなければならない (MUST)。リセットの実行前に利用者へ確認を求めなければならない (SHALL)。復号不能でない状態のリセット要求は拒否しなければならない (MUST)。

#### Scenario: リセットの実行

- **WHEN** 復号不能状態で利用者がリセットを実行し、確認に同意する
- **THEN** 既存の `totp.enc` はタイムスタンプ付きの退避ファイルへ移動され、シード一覧は空・解錠済み・復号不能の解除された状態になる

#### Scenario: リセット後の再登録

- **WHEN** リセット後に QR コード画像をドラッグ＆ドロップする
- **THEN** シードが現行の暗号鍵で `totp.enc` に保存され、コードが表示される

#### Scenario: 確認のキャンセル

- **WHEN** 利用者がリセットの確認をキャンセルする
- **THEN** 退避も状態の変更も行われない

#### Scenario: 正常時のリセット拒否

- **WHEN** 復号に成功している状態でリセットが要求される
- **THEN** リセットは実行されず、保存済みシードは変更されない

#### Scenario: 正常時の非提示

- **WHEN** 復号に成功している、または解錠前である
- **THEN** リセット操作は UI に提示されない

