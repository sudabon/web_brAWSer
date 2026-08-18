export const BROWSER_ACCOUNT_COLOR_ARG_PREFIX = "--brawser-account-color=";
export const ACCOUNT_COLOR_IPC = "account-color:set";
export const ACCOUNT_COLOR_BAR_ID = "brawser-account-color-bar";
export const ACCOUNT_COLOR_BAR_HEIGHT_PX = 6;

export function accountColorFromArgv(argv: readonly string[]): string | undefined {
  const found = argv.find((arg) => arg.startsWith(BROWSER_ACCOUNT_COLOR_ARG_PREFIX));
  const value = found?.slice(BROWSER_ACCOUNT_COLOR_ARG_PREFIX.length);
  return value || undefined;
}
