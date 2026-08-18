import { describe, expect, it } from "vitest";
import type { AccountRoleView } from "../shared/types";
import { searchAccountRoles } from "./accountSearch";

const accounts: AccountRoleView[] = [
  {
    accountId: "111111111111",
    accountName: "prod-main",
    roleName: "AdministratorAccess",
    accountRoleKey: "111111111111#AdministratorAccess",
    partition: "persist:acct-111111111111-AdministratorAccess",
    color: "#7aa2ff",
    tags: ["prod"],
    defaultRegion: "ap-northeast-1",
  },
  {
    accountId: "222222222222",
    accountName: "recordati-dev",
    roleName: "ReadOnly",
    accountRoleKey: "222222222222#ReadOnly",
    partition: "persist:acct-222222222222-ReadOnly",
    color: "#7ee0a3",
    tags: ["dev"],
    defaultRegion: "ap-northeast-1",
  },
];

describe("searchAccountRoles", () => {
  it("matches account name, id, and role name", () => {
    expect(searchAccountRoles("recordati", accounts).map((item) => item.accountId)).toEqual([
      "222222222222",
    ]);
    expect(searchAccountRoles("111111", accounts).map((item) => item.accountId)).toEqual([
      "111111111111",
    ]);
    expect(searchAccountRoles("ReadOnly", accounts).map((item) => item.roleName)).toEqual([
      "ReadOnly",
    ]);
  });
});
