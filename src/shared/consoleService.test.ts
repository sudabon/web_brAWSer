import { describe, expect, it } from "vitest";
import { consoleServiceLabel } from "./consoleService.ts";
import { AWS_SERVICES, consoleServiceUrl } from "./awsServices.ts";

describe("consoleServiceLabel", () => {
  it("names the service from the first path segment", () => {
    expect(
      consoleServiceLabel(
        "https://ap-northeast-1.console.aws.amazon.com/s3/buckets/assets-prod?region=ap-northeast-1",
      ),
    ).toBe("S3");
  });

  it("names the service when the resource lives in the hash", () => {
    expect(
      consoleServiceLabel(
        "https://ap-northeast-1.console.aws.amazon.com/lambda/home?region=ap-northeast-1#/functions/order-worker",
      ),
    ).toBe("Lambda");
  });

  it("uses the display name rather than the raw segment", () => {
    expect(
      consoleServiceLabel("https://ap-northeast-1.console.aws.amazon.com/dynamodbv2/home"),
    ).toBe("DynamoDB");
    expect(
      consoleServiceLabel("https://ap-northeast-1.console.aws.amazon.com/systems-manager/home"),
    ).toBe("Systems Manager");
  });

  it("separates CloudWatch Logs from the rest of CloudWatch", () => {
    expect(
      consoleServiceLabel(
        "https://ap-northeast-1.console.aws.amazon.com/cloudwatch/home#logsV2:log-groups",
      ),
    ).toBe("CloudWatch Logs");
    expect(
      consoleServiceLabel("https://ap-northeast-1.console.aws.amazon.com/cloudwatch/home#metricsV2"),
    ).toBe("CloudWatch");
  });

  it("names Cognito for both user pools and identity pools", () => {
    expect(
      consoleServiceLabel(
        "https://ap-northeast-1.console.aws.amazon.com/cognito/v2/idp/user-pools?region=ap-northeast-1",
      ),
    ).toBe("Cognito");
    expect(
      consoleServiceLabel(
        "https://ap-northeast-1.console.aws.amazon.com/cognito/v2/identity/identity-pools?region=ap-northeast-1",
      ),
    ).toBe("Cognito");
  });

  it("labels the console home page", () => {
    expect(consoleServiceLabel("https://ap-northeast-1.console.aws.amazon.com/console/home")).toBe(
      "ホーム",
    );
    expect(consoleServiceLabel("https://console.aws.amazon.com/console/home")).toBe("ホーム");
  });

  it("resolves every service offered by the command palette", () => {
    for (const service of AWS_SERVICES) {
      expect(consoleServiceLabel(consoleServiceUrl("ap-northeast-1", service.path)), service.id).toBe(
        service.name,
      );
    }
  });

  it("returns undefined outside the console", () => {
    expect(consoleServiceLabel("https://signin.aws.amazon.com/federation")).toBeUndefined();
    expect(consoleServiceLabel("https://example.awsapps.com/start")).toBeUndefined();
  });

  it("returns undefined for unknown services and unusable urls", () => {
    expect(
      consoleServiceLabel("https://ap-northeast-1.console.aws.amazon.com/not-a-service/home"),
    ).toBeUndefined();
    expect(consoleServiceLabel("")).toBeUndefined();
    expect(consoleServiceLabel("about:blank")).toBeUndefined();
  });
});
