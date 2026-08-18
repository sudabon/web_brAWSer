import { describe, expect, it } from "vitest";
import { isAllowed } from "./NavigationGuard.ts";

describe("isAllowed", () => {
  it("allows regional AWS console URLs", () => {
    expect(
      isAllowed("https://ap-northeast-1.console.aws.amazon.com/ec2/home"),
    ).toBe(true);
  });

  it("allows signin, docs, and health hosts", () => {
    expect(isAllowed("https://signin.aws.amazon.com/federation")).toBe(true);
    expect(
      isAllowed(
        "https://ap-northeast-1.signin.aws/platform/d-9567941301/login",
      ),
    ).toBe(true);
    expect(isAllowed("https://signin.aws/")).toBe(true);
    expect(isAllowed("https://docs.aws.amazon.com/ec2/")).toBe(true);
    expect(isAllowed("https://health.aws.amazon.com/health/home")).toBe(true);
  });

  it("allows AWS-managed wildcard hosts", () => {
    expect(isAllowed("https://d-example.awsapps.com/start")).toBe(true);
    expect(isAllowed("https://oidc.ap-northeast-1.amazonaws.com/")).toBe(true);
    expect(isAllowed("https://us-east-1.aws.amazon.com/")).toBe(true);
    expect(isAllowed("https://a0.awsstatic.com/asset.js")).toBe(true);
    expect(isAllowed("https://d111111abcdef8.cloudfront.net/asset")).toBe(
      true,
    );
  });

  it("rejects unrelated sites", () => {
    expect(isAllowed("https://github.com/example/repo")).toBe(false);
  });

  it("rejects unparseable URLs without throwing", () => {
    expect(() => isAllowed("not a url")).not.toThrow();
    expect(isAllowed("not a url")).toBe(false);
    expect(isAllowed("")).toBe(false);
  });

  it("rejects suffix and prefix lookalikes at the subdomain boundary", () => {
    expect(isAllowed("https://console.aws.amazon.com.evil.com/")).toBe(false);
    expect(isAllowed("https://ap-northeast-1.signin.aws.evil.com/")).toBe(false);
    expect(isAllowed("https://evilamazonaws.com/")).toBe(false);
    expect(isAllowed("https://aws.amazon.com.attacker.example/")).toBe(false);
  });

  it("rejects non-http(s) schemes even on allowed hosts", () => {
    expect(isAllowed("javascript:alert(1)")).toBe(false);
    expect(isAllowed("ftp://console.aws.amazon.com/")).toBe(false);
  });
});
