import * as OTPAuth from "otpauth";
import type { TotpAlgorithm, TotpSeed } from "../shared/types.ts";

export type TotpSeedDraft = {
  issuer: string;
  label: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
};

export const DEFAULT_TOTP_ALGORITHM: TotpAlgorithm = "SHA1";
export const DEFAULT_TOTP_DIGITS = 6;
export const DEFAULT_TOTP_PERIOD = 30;

export function remainingSeconds(period: number, nowMs: number): number {
  const elapsed = Math.floor(nowMs / 1000) % period;
  return period - elapsed;
}

export function generateTotpCode(seed: Pick<TotpSeed, "secret" | "algorithm" | "digits" | "period">, nowMs: number): string {
  return OTPAuth.TOTP.generate({
    secret: OTPAuth.Secret.fromBase32(seed.secret),
    algorithm: seed.algorithm,
    digits: seed.digits,
    period: seed.period,
    timestamp: nowMs,
  });
}

export function normalizeBase32(secret: string): string {
  return secret.replace(/[\s-]/g, "").toUpperCase();
}

export function validateBase32(secret: string): string {
  const normalized = normalizeBase32(secret);
  if (!normalized) {
    throw new Error("Base32 シークレットが空です");
  }
  try {
    OTPAuth.Secret.fromBase32(normalized);
  } catch {
    throw new Error("Base32 シークレットが不正です");
  }
  return normalized;
}

export function parseOtpAuthUri(uri: string): TotpSeedDraft {
  const trimmed = uri.trim();
  let parsed: OTPAuth.HOTP | OTPAuth.TOTP;
  try {
    parsed = OTPAuth.URI.parse(trimmed);
  } catch {
    throw new Error("otpauth URI が不正です");
  }
  if (!(parsed instanceof OTPAuth.TOTP)) {
    throw new Error("TOTP 以外の URI は登録できません");
  }
  return {
    issuer: parsed.issuer || "",
    label: parsed.label || "",
    secret: validateBase32(parsed.secret.base32),
    algorithm: normalizeAlgorithm(parsed.algorithm),
    digits: parsed.digits || DEFAULT_TOTP_DIGITS,
    period: parsed.period || DEFAULT_TOTP_PERIOD,
  };
}

export function parseManualSecret(input: {
  issuer: string;
  label: string;
  secret: string;
}): TotpSeedDraft {
  return {
    issuer: input.issuer.trim(),
    label: input.label.trim(),
    secret: validateBase32(input.secret),
    algorithm: DEFAULT_TOTP_ALGORITHM,
    digits: DEFAULT_TOTP_DIGITS,
    period: DEFAULT_TOTP_PERIOD,
  };
}

export function parseAuthenticatorBackup(raw: string): TotpSeedDraft[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("バックアップが空です");
  }

  const uriLines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("otpauth://"));
  if (uriLines.length > 0 && (trimmed.startsWith("otpauth://") || !looksLikeJson(trimmed))) {
    return uriLines.map((line) => parseOtpAuthUri(line));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Authenticator バックアップの形式が不正です");
  }

  const drafts: TotpSeedDraft[] = [];
  const skippedEncrypted: string[] = [];

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const result = draftFromUnknownEntry(entry);
      if (result.status === "encrypted") {
        skippedEncrypted.push(result.label);
        continue;
      }
      if (result.status === "ok") {
        drafts.push(result.draft);
      }
    }
  } else if (parsed && typeof parsed === "object") {
    for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (key === "UserSettings" || key === "key") {
        continue;
      }
      const result = draftFromUnknownEntry(entry);
      if (result.status === "encrypted") {
        skippedEncrypted.push(result.label);
        continue;
      }
      if (result.status === "ok") {
        drafts.push(result.draft);
      }
    }
  } else {
    throw new Error("Authenticator バックアップの形式が不正です");
  }

  if (drafts.length === 0) {
    if (skippedEncrypted.length > 0) {
      throw new Error(
        "暗号化されたバックアップはインポートできません。Authenticator で暗号化なしのバックアップを書き出してください。",
      );
    }
    throw new Error("インポートできる TOTP シードが見つかりませんでした");
  }
  return drafts;
}

function looksLikeJson(value: string): boolean {
  return value.startsWith("{") || value.startsWith("[");
}

function normalizeAlgorithm(value: string | undefined): TotpAlgorithm {
  const upper = (value ?? DEFAULT_TOTP_ALGORITHM).toUpperCase().replaceAll("-", "");
  if (upper === "SHA1" || upper === "SHA256" || upper === "SHA512") {
    return upper;
  }
  throw new Error(`未対応の algorithm です: ${value}`);
}

function draftFromUnknownEntry(
  entry: unknown,
): { status: "ok"; draft: TotpSeedDraft } | { status: "encrypted"; label: string } | { status: "skip" } {
  if (!entry || typeof entry !== "object") {
    return { status: "skip" };
  }
  const record = entry as Record<string, unknown>;
  if (record.dataType === "Key" || record.dataType === "EncOTPStorage") {
    return record.dataType === "EncOTPStorage"
      ? { status: "encrypted", label: String(record.hash ?? "") }
      : { status: "skip" };
  }
  if (record.encrypted === true) {
    return { status: "encrypted", label: String(record.account ?? record.issuer ?? "") };
  }
  if (typeof record.secret !== "string" || record.secret.length === 0) {
    return { status: "skip" };
  }
  const type = String(record.type ?? "totp").toLowerCase();
  if (type && type !== "totp" && type !== "0") {
    return { status: "skip" };
  }
  const issuer = typeof record.issuer === "string" ? record.issuer : "";
  const label =
    typeof record.account === "string"
      ? record.account
      : typeof record.label === "string"
        ? record.label
        : "";
  return {
    status: "ok",
    draft: {
      issuer,
      label,
      secret: validateBase32(record.secret),
      algorithm: parseAuthenticatorAlgorithm(record.algorithm),
      digits: typeof record.digits === "number" && record.digits > 0 ? record.digits : DEFAULT_TOTP_DIGITS,
      period: typeof record.period === "number" && record.period > 0 ? record.period : DEFAULT_TOTP_PERIOD,
    },
  };
}

function parseAuthenticatorAlgorithm(value: unknown): TotpAlgorithm {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_TOTP_ALGORITHM;
  }
  if (value === 0 || value === "0") {
    return "SHA1";
  }
  if (value === 1 || value === "1") {
    return "SHA256";
  }
  if (value === 2 || value === "2") {
    return "SHA512";
  }
  if (typeof value === "string") {
    return normalizeAlgorithm(value);
  }
  return DEFAULT_TOTP_ALGORITHM;
}
