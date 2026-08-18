import { describe, expect, it } from "vitest";
import {
  generateTotpCode,
  parseAuthenticatorBackup,
  parseManualSecret,
  parseOtpAuthUri,
  remainingSeconds,
  validateBase32,
} from "./totpParse.ts";

describe("totpParse", () => {
  it("parses otpauth URI and applies SHA1 / 6 / 30 defaults", () => {
    const draft = parseOtpAuthUri(
      "otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example",
    );
    expect(draft.issuer).toBe("Example");
    expect(draft.label).toBe("alice@example.com");
    expect(draft.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(draft.algorithm).toBe("SHA1");
    expect(draft.digits).toBe(6);
    expect(draft.period).toBe(30);
  });

  it("keeps non-default algorithm digits and period", () => {
    const draft = parseOtpAuthUri(
      "otpauth://totp/ACME:bob?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=SHA256&digits=8&period=60",
    );
    expect(draft.algorithm).toBe("SHA256");
    expect(draft.digits).toBe(8);
    expect(draft.period).toBe(60);
  });

  it("rejects invalid Base32", () => {
    expect(() => validateBase32("not*valid")).toThrow(/不正/);
    expect(() => parseManualSecret({ issuer: "A", label: "B", secret: "!!!!" })).toThrow(/不正/);
  });

  it("rejects HOTP URIs", () => {
    expect(() =>
      parseOtpAuthUri("otpauth://hotp/ACME:alice?secret=JBSWY3DPEHPK3PXP&counter=0"),
    ).toThrow(/TOTP 以外/);
  });

  it("imports Authenticator JSON map", () => {
    const drafts = parseAuthenticatorBackup(
      JSON.stringify({
        "22e991a1711a51f8aab522081666b5d3": {
          account: "alice",
          hash: "22e991a1711a51f8aab522081666b5d3",
          issuer: "AWS",
          secret: "JBSWY3DPEHPK3PXP",
          type: "totp",
          encrypted: false,
          index: 0,
        },
      }),
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.issuer).toBe("AWS");
    expect(drafts[0]?.label).toBe("alice");
    expect(drafts[0]?.secret).toBe("JBSWY3DPEHPK3PXP");
  });

  it("imports newline-separated otpauth URIs", () => {
    const drafts = parseAuthenticatorBackup(
      [
        "otpauth://totp/example.com?secret=JBSWY3DPEHPK3PXP",
        "otpauth://totp/Test:user?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Test&period=60",
      ].join("\n"),
    );
    expect(drafts).toHaveLength(2);
    expect(drafts[1]?.period).toBe(60);
  });

  it("rejects encrypted Authenticator backups", () => {
    expect(() =>
      parseAuthenticatorBackup(
        JSON.stringify({
          abc: { secret: "cipher", encrypted: true, type: "totp", issuer: "AWS" },
        }),
      ),
    ).toThrow(/暗号化/);
  });

  it("generates RFC 6238 SHA1 8-digit vector at t=59", () => {
    const code = generateTotpCode(
      {
        secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        algorithm: "SHA1",
        digits: 8,
        period: 30,
      },
      59_000,
    );
    expect(code).toBe("94287082");
  });

  it("uses SHA256 parameters for non-standard seeds", () => {
    const sha1 = generateTotpCode(
      {
        secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        algorithm: "SHA1",
        digits: 8,
        period: 30,
      },
      59_000,
    );
    const sha256 = generateTotpCode(
      {
        secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        algorithm: "SHA256",
        digits: 8,
        period: 60,
      },
      59_000,
    );
    expect(sha256).toMatch(/^\d{8}$/);
    expect(sha256).not.toBe(sha1);
  });

  it("computes remaining seconds within the period", () => {
    expect(remainingSeconds(30, 0)).toBe(30);
    expect(remainingSeconds(30, 1_000)).toBe(29);
    expect(remainingSeconds(30, 29_000)).toBe(1);
    expect(remainingSeconds(30, 30_000)).toBe(30);
  });
});
