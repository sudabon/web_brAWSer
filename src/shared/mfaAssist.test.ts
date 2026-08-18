import { describe, expect, it } from "vitest";
import {
  isIdentityCenterSignInUrl,
  isSsoPortalPartition,
  partitionFromArgv,
  shouldAssistMfa,
  TOTP_CURRENT_CODE_IPC,
} from "./mfaAssist.ts";
import { IPC } from "./types.ts";

describe("mfaAssist guards", () => {
  it("recognizes persist:sso-portal", () => {
    expect(isSsoPortalPartition("persist:sso-portal")).toBe(true);
    expect(isSsoPortalPartition("persist:acct-123-Admin")).toBe(false);
  });

  it("reads partition from argv", () => {
    expect(
      partitionFromArgv(["--type=renderer", "--brawser-partition=persist:sso-portal"]),
    ).toBe("persist:sso-portal");
  });

  it("allows Identity Center sign-in hosts", () => {
    expect(isIdentityCenterSignInUrl("https://d-123.awsapps.com/start/#/device")).toBe(true);
    expect(isIdentityCenterSignInUrl("https://d-123.awsapps.com/login")).toBe(true);
    expect(
      isIdentityCenterSignInUrl(
        "https://ap-northeast-1.signin.aws/platform/d-9567941301/login",
      ),
    ).toBe(true);
    expect(
      isIdentityCenterSignInUrl("https://device.sso.ap-northeast-1.amazonaws.com/?user_code=ABCD"),
    ).toBe(true);
  });

  it("rejects console and unrelated pages", () => {
    expect(isIdentityCenterSignInUrl("https://ap-northeast-1.console.aws.amazon.com/")).toBe(false);
    expect(isIdentityCenterSignInUrl("https://signin.aws.amazon.com/federation")).toBe(false);
    expect(isIdentityCenterSignInUrl("not a url")).toBe(false);
  });

  it("requires both partition and Identity Center URL", () => {
    expect(
      shouldAssistMfa(
        "persist:sso-portal",
        "https://ap-northeast-1.signin.aws/platform/d-123/login",
      ),
    ).toBe(true);
    expect(
      shouldAssistMfa("persist:acct-1-Admin", "https://d-123.awsapps.com/login"),
    ).toBe(false);
    expect(
      shouldAssistMfa("persist:sso-portal", "https://us-east-1.console.aws.amazon.com/"),
    ).toBe(false);
  });

  it("keeps the AWS preload TOTP channel aligned with IPC.totpCurrentCode", () => {
    expect(TOTP_CURRENT_CODE_IPC).toBe(IPC.totpCurrentCode);
  });
});
