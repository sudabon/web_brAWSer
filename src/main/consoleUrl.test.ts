import { describe, expect, it } from "vitest";
import { rewriteConsoleRegion } from "./consoleUrl.ts";

describe("rewriteConsoleRegion", () => {
  it("rewrites the regional console host and region query", () => {
    expect(
      rewriteConsoleRegion(
        "https://ap-northeast-1.console.aws.amazon.com/s3/home?region=ap-northeast-1",
        "us-east-1",
      ),
    ).toBe("https://us-east-1.console.aws.amazon.com/s3/home?region=us-east-1");
  });
});
