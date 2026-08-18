export const BROWSER_PARTITION_ARG_PREFIX = "--brawser-partition=";
export const TOTP_CURRENT_CODE_IPC = "totp:current-code";

export function partitionFromArgv(argv: readonly string[]): string {
  const found = argv.find((arg) => arg.startsWith(BROWSER_PARTITION_ARG_PREFIX));
  return found?.slice(BROWSER_PARTITION_ARG_PREFIX.length) ?? "";
}

export function isSsoPortalPartition(partition: string): boolean {
  return partition === "persist:sso-portal";
}

export function isIdentityCenterSignInUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith(".awsapps.com")) {
      return true;
    }
    if (/^([\w-]+\.)*signin\.aws$/.test(host)) {
      return true;
    }
    if (/^device\.sso\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function shouldAssistMfa(partition: string, url: string): boolean {
  return isSsoPortalPartition(partition) && isIdentityCenterSignInUrl(url);
}
