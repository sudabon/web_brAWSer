const ALLOWED_HOST_PATTERNS: readonly RegExp[] = [
  /^signin\.aws\.amazon\.com$/i,
  /^([\w-]+\.)*signin\.aws$/i,
  /^([\w-]+\.)*console\.aws\.amazon\.com$/i,
  /^([\w-]+\.)*awsapps\.com$/i,
  /^([\w-]+\.)*amazonaws\.com$/i,
  /^([\w-]+\.)*aws\.amazon\.com$/i,
  /^([\w-]+\.)*awsstatic\.com$/i,
  /^([\w-]+\.)*cloudfront\.net$/i,
  /^docs\.aws\.amazon\.com$/i,
  /^health\.aws\.amazon\.com$/i,
];

export function isAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    return ALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname));
  } catch {
    return false;
  }
}
