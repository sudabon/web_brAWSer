export const DEFAULT_MAX_LIVE_TABS_PER_ACCOUNT = 10;

export type HibernateCandidate = {
  id: string;
  accountRoleKey: string;
  hibernated: boolean;
  lastActiveAt: number;
};

export function isInactivePastThreshold(
  lastActiveAt: number,
  now: number,
  hibernateAfterMs: number,
): boolean {
  return now - lastActiveAt >= hibernateAfterMs;
}

export function tabsToHibernateForInactivity(
  tabs: HibernateCandidate[],
  now: number,
  hibernateAfterMs: number,
  activeId: string | null,
): string[] {
  return tabs
    .filter(
      (tab) =>
        !tab.hibernated &&
        tab.id !== activeId &&
        isInactivePastThreshold(tab.lastActiveAt, now, hibernateAfterMs),
    )
    .map((tab) => tab.id);
}

export function tabsToHibernateForAccountLimit(
  tabs: HibernateCandidate[],
  accountRoleKey: string,
  maxLive: number,
  activeId: string | null,
): string[] {
  const live = tabs
    .filter((tab) => tab.accountRoleKey === accountRoleKey && !tab.hibernated)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt);
  const overflow = live.length - maxLive;
  if (overflow <= 0) {
    return [];
  }
  const victims: string[] = [];
  for (const tab of live) {
    if (victims.length >= overflow) {
      break;
    }
    if (tab.id === activeId) {
      continue;
    }
    victims.push(tab.id);
  }
  return victims;
}
