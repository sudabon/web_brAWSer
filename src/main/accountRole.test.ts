import { describe, expect, it } from "vitest";
import { parseAccountRoleKey, toAccountRoleKey } from "./accountRole.ts";

describe("toAccountRoleKey", () => {
  it("uses accountId#roleName", () => {
    expect(toAccountRoleKey("111111111111", "ReadOnly")).toBe("111111111111#ReadOnly");
  });
});

describe("parseAccountRoleKey", () => {
  it("rejects keys without a hash separator", () => {
    expect(() => parseAccountRoleKey("111111111111/ReadOnly")).toThrow(
      /invalid accountRoleKey/,
    );
  });
});
