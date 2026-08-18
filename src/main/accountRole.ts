export function toAccountRoleKey(accountId: string, roleName: string): string {
  return `${accountId}#${roleName}`;
}

export function parseAccountRoleKey(accountRoleKey: string): {
  accountId: string;
  roleName: string;
} {
  const separator = accountRoleKey.indexOf("#");
  if (separator <= 0 || separator === accountRoleKey.length - 1) {
    throw new Error(`invalid accountRoleKey: ${accountRoleKey}`);
  }
  return {
    accountId: accountRoleKey.slice(0, separator),
    roleName: accountRoleKey.slice(separator + 1),
  };
}
