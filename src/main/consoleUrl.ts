import { CONSOLE_REGIONS } from "../shared/regions.ts";

const REGION_HOST = /^([a-z]{2}(?:-[a-z]+)+-\d+)\.console\.aws\.amazon\.com$/i;

export function rewriteConsoleRegion(url: string, region: string): string {
  const parsed = new URL(url);
  const hostMatch = parsed.hostname.match(REGION_HOST);
  if (hostMatch) {
    parsed.hostname = `${region}.console.aws.amazon.com`;
  }
  if (parsed.searchParams.has("region")) {
    parsed.searchParams.set("region", region);
  } else if (parsed.hostname.endsWith("console.aws.amazon.com")) {
    parsed.searchParams.set("region", region);
  }
  return parsed.toString();
}

export { CONSOLE_REGIONS };
