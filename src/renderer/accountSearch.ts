import Fuse from "fuse.js";
import type { AccountRoleView } from "../shared/types";

export function searchAccountRoles(
  query: string,
  accounts: AccountRoleView[],
): AccountRoleView[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return accounts;
  }
  const fuse = new Fuse(accounts, {
    keys: ["accountName", "accountId", "roleName"],
    threshold: 0.4,
    ignoreLocation: true,
  });
  return fuse.search(trimmed).map((result) => result.item);
}
