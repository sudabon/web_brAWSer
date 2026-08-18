const PERSIST_PREFIX = "persist:";
export const SSO_PORTAL_PARTITION = `${PERSIST_PREFIX}sso-portal`;

function sanitizeAccountId(accountId: string): string {
  return accountId.replace(/[^a-zA-Z0-9-]/g, "");
}

function sanitizeRoleName(roleName: string): string {
  return roleName.replace(/[^a-zA-Z0-9+=,.@_-]/g, "");
}

export function partitionName(accountId: string, roleName: string): string {
  return `${PERSIST_PREFIX}acct-${sanitizeAccountId(accountId)}-${sanitizeRoleName(roleName)}`;
}

export function partitionFromAccountRoleKey(accountRoleKey: string): string {
  const separator = accountRoleKey.indexOf("#");
  if (separator === -1) {
    return partitionName(accountRoleKey, "default");
  }
  return partitionName(
    accountRoleKey.slice(0, separator),
    accountRoleKey.slice(separator + 1),
  );
}
