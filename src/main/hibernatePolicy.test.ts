import { describe, expect, it } from "vitest";
import { DEFAULT_HIBERNATE_AFTER_MS } from "./PersistenceStore.ts";
import {
  DEFAULT_MAX_LIVE_TABS_PER_ACCOUNT,
  tabsToHibernateForAccountLimit,
  tabsToHibernateForInactivity,
} from "./hibernatePolicy.ts";

describe("tabsToHibernateForInactivity", () => {
  it("hibernates live tabs idle longer than the threshold and skips the active tab", () => {
    const now = 2_000_000;
    const ids = tabsToHibernateForInactivity(
      [
        { id: "active", accountRoleKey: "a#r", hibernated: false, lastActiveAt: 0 },
        { id: "idle", accountRoleKey: "a#r", hibernated: false, lastActiveAt: 0 },
        { id: "recent", accountRoleKey: "a#r", hibernated: false, lastActiveAt: now },
        { id: "already", accountRoleKey: "a#r", hibernated: true, lastActiveAt: 0 },
      ],
      now,
      DEFAULT_HIBERNATE_AFTER_MS,
      "active",
    );
    expect(ids).toEqual(["idle"]);
  });
});

describe("tabsToHibernateForAccountLimit", () => {
  it("picks the oldest live tabs over the per-account cap and never closes them", () => {
    const tabs = Array.from({ length: 11 }, (_, index) => ({
      id: `t${index + 1}`,
      accountRoleKey: "acct#Admin",
      hibernated: false,
      lastActiveAt: index + 1,
    }));
    const ids = tabsToHibernateForAccountLimit(
      tabs,
      "acct#Admin",
      DEFAULT_MAX_LIVE_TABS_PER_ACCOUNT,
      "t11",
    );
    expect(ids).toEqual(["t1"]);
    expect(tabs).toHaveLength(11);
  });

  it("does not hibernate tabs that already count as hibernated", () => {
    const ids = tabsToHibernateForAccountLimit(
      [
        { id: "old", accountRoleKey: "acct#Admin", hibernated: true, lastActiveAt: 1 },
        ...Array.from({ length: 10 }, (_, index) => ({
          id: `live${index}`,
          accountRoleKey: "acct#Admin",
          hibernated: false,
          lastActiveAt: 10 + index,
        })),
      ],
      "acct#Admin",
      10,
      "live9",
    );
    expect(ids).toEqual([]);
  });
});
