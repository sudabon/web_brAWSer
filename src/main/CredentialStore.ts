import type { SafeStoragePort } from "./SsoManager.ts";
import type { UnlockGate } from "./TotpStore.ts";

/** ディスク上（creds.enc、safeStorage 暗号化）にのみ置かれる形。 */
type StoredCredential = {
  id: string;
  label: string;
  username: string;
  password: string;
};

/** レンダラへ渡してよい形。パスワードを含めない。 */
export type CredentialView = {
  id: string;
  label: string;
  username: string;
};

export type CredentialDraft = {
  label: string;
  username: string;
  password: string;
};

export type CredentialSnapshot = {
  locked: boolean;
  encryptionAvailable: boolean;
  touchIdAvailable: boolean;
  count: number;
  credentials: CredentialView[];
  errorMessage?: string;
};

export type CredentialFill = {
  username: string;
  password: string;
};

export type CredentialStoreOptions = {
  credentialsEncPath: string;
  safeStorage: SafeStoragePort;
  unlockGate: UnlockGate;
  id?: () => string;
  readFile: (path: string) => Promise<Buffer | null>;
  writeFile: (path: string, data: Buffer) => Promise<void>;
  onChange?: () => void;
};

/**
 * Identity Center サインイン画面へ入力する ID / パスワードの保管庫。
 * TotpStore と同じく safeStorage 暗号化 + Touch ID ゲートを前提にする。
 */
export class CredentialStore {
  #credentials: StoredCredential[] = [];
  #locked = true;
  #error: string | undefined;
  #count = 0;

  constructor(private readonly options: CredentialStoreOptions) {}

  lock(): void {
    this.#credentials = [];
    this.#locked = true;
    this.options.onChange?.();
  }

  async unlock(): Promise<boolean> {
    if (!this.#locked) {
      return true;
    }
    const ok = await this.options.unlockGate.promptUnlock("サインイン情報を解錠");
    if (!ok) {
      this.#error = "認証がキャンセルされたか失敗したため、サインイン情報は使えません。";
      this.options.onChange?.();
      return false;
    }
    if (!this.options.safeStorage.isEncryptionAvailable()) {
      this.#credentials = [];
      this.#count = 0;
      this.#locked = false;
      this.#error = "暗号化が利用できないため、サインイン情報は保存・復号できません。";
      this.options.onChange?.();
      return true;
    }
    const blob = await this.options.readFile(this.options.credentialsEncPath);
    if (!blob) {
      this.#credentials = [];
      this.#count = 0;
      this.#locked = false;
      this.#error = undefined;
      this.options.onChange?.();
      return true;
    }
    try {
      const plain = this.options.safeStorage.decryptString(blob);
      const parsed = JSON.parse(plain) as StoredCredential[];
      this.#credentials = Array.isArray(parsed) ? parsed : [];
      this.#count = this.#credentials.length;
      this.#locked = false;
      this.#error = undefined;
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
      this.options.onChange?.();
      return false;
    }
    this.options.onChange?.();
    return true;
  }

  view(): CredentialSnapshot {
    return {
      locked: this.#locked,
      encryptionAvailable: this.options.safeStorage.isEncryptionAvailable(),
      touchIdAvailable: this.options.unlockGate.canPromptBiometric(),
      count: this.#count,
      errorMessage: this.#error,
      credentials: this.#locked
        ? []
        : this.#credentials.map(
            (credential): CredentialView => ({
              id: credential.id,
              label: credential.label,
              username: credential.username,
            }),
          ),
    };
  }

  async save(draft: CredentialDraft): Promise<void> {
    if (!(await this.unlock())) {
      throw new Error(this.#error ?? "サインイン情報はロックされています");
    }
    if (!this.options.safeStorage.isEncryptionAvailable()) {
      this.#error = "暗号化が利用できないため、サインイン情報は保存しません。";
      this.options.onChange?.();
      throw new Error(this.#error);
    }
    const label = draft.label.trim();
    const username = draft.username.trim();
    if (!username || !draft.password) {
      throw new Error("ユーザー名とパスワードを入力してください");
    }
    const existing = this.#credentials.find(
      (credential) => credential.label === label && credential.username === username,
    );
    if (existing) {
      existing.password = draft.password;
    } else {
      this.#credentials.push({
        id: this.options.id?.() ?? crypto.randomUUID(),
        label,
        username,
        password: draft.password,
      });
    }
    await this.#persist();
    this.#error = undefined;
    this.options.onChange?.();
  }

  async remove(id: string): Promise<void> {
    if (!(await this.unlock())) {
      throw new Error(this.#error ?? "サインイン情報はロックされています");
    }
    const index = this.#credentials.findIndex((credential) => credential.id === id);
    if (index === -1) {
      return;
    }
    this.#credentials.splice(index, 1);
    await this.#persist();
    this.options.onChange?.();
  }

  /** サインイン画面の preload からのみ呼ばれる。復号値はここでしか外に出さない。 */
  async currentForAssist(): Promise<CredentialFill> {
    if (!(await this.unlock())) {
      throw new Error(this.#error ?? "サインイン情報はロックされています");
    }
    const credential = this.#credentials[0];
    if (!credential) {
      throw new Error("登録されたサインイン情報がありません");
    }
    return { username: credential.username, password: credential.password };
  }

  async #persist(): Promise<void> {
    if (!this.options.safeStorage.isEncryptionAvailable()) {
      this.#error = "暗号化が利用できないため、サインイン情報は保存しません。";
      this.options.onChange?.();
      throw new Error(this.#error);
    }
    const encrypted = this.options.safeStorage.encryptString(JSON.stringify(this.#credentials));
    await this.options.writeFile(this.options.credentialsEncPath, encrypted);
    this.#count = this.#credentials.length;
  }
}
