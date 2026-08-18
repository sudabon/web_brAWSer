import { describe, expect, it } from "vitest";
import { searchAwsServices } from "./serviceSearch.ts";

describe("searchAwsServices", () => {
  it("finds S3 from a short query", () => {
    const results = searchAwsServices("s3");
    expect(results[0]?.id).toBe("s3");
  });
});
