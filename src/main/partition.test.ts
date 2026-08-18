import { describe, expect, it } from "vitest";
import {
  parseAccountRoleKey,
  toAccountRoleKey,
} from "./accountRole.ts";
import {
  partitionFromAccountRoleKey,
  partitionName,
  SSO_PORTAL_PARTITION,
} from "./partition.ts";

describe("accountRoleKey", () => {
  it("joins accountId and roleName with #", () => {
    expect(toAccountRoleKey("123456789012", "AdministratorAccess")).toBe(
      "123456789012#AdministratorAccess",
    );
  });

  it("parses accountId and roleName from the key", () => {
    expect(parseAccountRoleKey("123456789012#AdministratorAccess")).toEqual({
      accountId: "123456789012",
      roleName: "AdministratorAccess",
    });
  });
});

describe("partitionName", () => {
  it("always prefixes persist:", () => {
    expect(partitionName("111111111111", "DummyRole").startsWith("persist:")).toBe(
      true,
    );
  });

  it("uses acct-<accountId>-<roleName>", () => {
    expect(partitionName("111111111111", "DummyRole")).toBe(
      "persist:acct-111111111111-DummyRole",
    );
  });

  it("does not let callers omit persistence by passing a bare name", () => {
    expect(partitionName("persist:already", "Role")).toBe(
      "persist:acct-persistalready-Role",
    );
  });
});

describe("partitionFromAccountRoleKey", () => {
  it("builds a persistent partition from accountId#roleName", () => {
    expect(partitionFromAccountRoleKey("123456789012#AdministratorAccess")).toBe(
      "persist:acct-123456789012-AdministratorAccess",
    );
  });
});

describe("SSO portal partition", () => {
  it("uses persist:sso-portal", () => {
    expect(SSO_PORTAL_PARTITION).toBe("persist:sso-portal");
  });
});
