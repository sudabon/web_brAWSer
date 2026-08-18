import type { TotpCodeView, TotpSeed, TotpSnapshot } from "../shared/types.ts";
import type { ClipboardGuard } from "./clipboardGuard.ts";
import type { SafeStoragePort } from "./SsoManager.ts";
import {
  generateTotpCode,
  parseAuthenticatorBackup,
  parseManualSecret,
  parseOtpAuthUri,
  remainingSeconds,
  type TotpSeedDraft,
} from "./totpParse.ts";

export type UnlockGate = {
  canPromptBiometric(): boolean;
  promptUnlock(reason: string): Promise<boolean>;
};

export type TotpStoreOptions = {
  totpEncPath: string;
  safeStorage: SafeStoragePort;
  unlockGate: UnlockGate;
  clipboard: ClipboardGuard;
  now?: () => number;
  id?: () => string;
  readFile: (path: string) => Promise<Buffer | null>;
  writeFile: (path: string, data: Buffer) => Promise<void>;
  onChange?: () => void;
};

export class TotpStore {
  #seeds: TotpSeed[] = [];
  #locked = true;
  #error: string | undefined;
  #seedCount = 0;

  constructor(private readonly options: TotpStoreOptions) {}

  now(): number {
    return this.options.now?.() ?? Date.now();
  }

  lock(): void {
    this.#seeds = [];
    this.#locked = true;
    this.options.onChange?.();
  }

  async unlock(): Promise<boolean> {
    if (!this.#locked) {
      return true;
    }
    const ok = await this.options.unlockGate.promptUnlock("TOTP シードを解錠");
    if (!ok) {
      this.#error = "認証がキャンセルされたか失敗したため、コードは表示されません。";
      this.options.onChange?.();
      return false;
    }
    if (!this.options.safeStorage.isEncryptionAvailable()) {
      this.#seeds = [];
      this.#seedCount = 0;
      this.#locked = false;
      this.#error = "暗号化が利用できないため、シードは保存・復号できません。";
      this.options.onChange?.();
      return true;
    }
    const blob = await this.options.readFile(this.options.totpEncPath);
    if (!blob) {
      this.#seeds = [];
      this.#seedCount = 0;
      this.#locked = false;
      this.#error = undefined;
      this.options.onChange?.();
      return true;
    }
    try {
      const plain = this.options.safeStorage.decryptString(blob);
      const parsed = JSON.parse(plain) as TotpSeed[];
      this.#seeds = Array.isArray(parsed) ? parsed : [];
      this.#seedCount = this.#seeds.length;
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

  view(): TotpSnapshot {
    const now = this.now();
    return {
      locked: this.#locked,
      encryptionAvailable: this.options.safeStorage.isEncryptionAvailable(),
      touchIdAvailable: this.options.unlockGate.canPromptBiometric(),
      seedCount: this.#seedCount,
      errorMessage: this.#error,
      codes: this.#locked
        ? []
        : this.#seeds.map((seed) => ({
            id: seed.id,
            issuer: seed.issuer,
            label: seed.label,
            code: generateTotpCode(seed, now),
            remainingSeconds: remainingSeconds(seed.period, now),
            period: seed.period,
          }) satisfies TotpCodeView),
    };
  }

  async importUri(uri: string): Promise<void> {
    await this.#importDrafts([parseOtpAuthUri(uri)]);
  }

  async importSecret(input: { issuer: string; label: string; secret: string }): Promise<void> {
    await this.#importDrafts([parseManualSecret(input)]);
  }

  async importBackup(raw: string): Promise<number> {
    const drafts = parseAuthenticatorBackup(raw);
    await this.#importDrafts(drafts);
    return drafts.length;
  }

  async copy(id: string): Promise<string> {
    if (!(await this.unlock())) {
      throw new Error(this.#error ?? "TOTP はロックされています");
    }
    const seed = this.#seeds.find((item) => item.id === id);
    if (!seed) {
      throw new Error("指定されたシードが見つかりません");
    }
    const code = generateTotpCode(seed, this.now());
    this.options.clipboard.copy(code);
    return code;
  }

  async currentCodeForAssist(): Promise<string> {
    if (!(await this.unlock())) {
      throw new Error(this.#error ?? "TOTP はロックされています");
    }
    const seed = pickAssistSeed(this.#seeds);
    if (!seed) {
      throw new Error("登録されたシードがありません");
    }
    return generateTotpCode(seed, this.now());
  }

  async #importDrafts(drafts: TotpSeedDraft[]): Promise<void> {
    if (!(await this.unlock())) {
      throw new Error(this.#error ?? "TOTP はロックされています");
    }
    if (!this.options.safeStorage.isEncryptionAvailable()) {
      this.#error = "暗号化が利用できないため、シードは保存しません。";
      this.options.onChange?.();
      throw new Error(this.#error);
    }
    for (const draft of drafts) {
      if (this.#seeds.some((seed) => seed.secret === draft.secret)) {
        continue;
      }
      this.#seeds.push({
        id: this.options.id?.() ?? crypto.randomUUID(),
        ...draft,
      });
    }
    await this.#persist();
    this.#error = undefined;
    this.options.onChange?.();
  }

  async #persist(): Promise<void> {
    if (!this.options.safeStorage.isEncryptionAvailable()) {
      this.#error = "暗号化が利用できないため、シードは保存しません。";
      this.options.onChange?.();
      throw new Error(this.#error);
    }
    const encrypted = this.options.safeStorage.encryptString(JSON.stringify(this.#seeds));
    await this.options.writeFile(this.options.totpEncPath, encrypted);
    this.#seedCount = this.#seeds.length;
  }
}

function pickAssistSeed(seeds: TotpSeed[]): TotpSeed | undefined {
  return (
    seeds.find((seed) => /aws|amazon|sso|identity/i.test(`${seed.issuer} ${seed.label}`)) ??
    seeds[0]
  );
}
