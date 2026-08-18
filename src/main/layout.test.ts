import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  TITLE_BAR_HEIGHT,
  clampPanelWidth,
  clampWindowSize,
  contentViewBounds,
  sidePanelBounds,
} from "./layout.ts";

describe("clampPanelWidth", () => {
  it("clamps to the configured min and max", () => {
    expect(clampPanelWidth(0)).toBe(MIN_PANEL_WIDTH);
    expect(clampPanelWidth(9999)).toBe(MAX_PANEL_WIDTH);
    expect(clampPanelWidth(DEFAULT_PANEL_WIDTH)).toBe(DEFAULT_PANEL_WIDTH);
  });
});

describe("clampWindowSize", () => {
  it("clamps to the minimum window size", () => {
    expect(clampWindowSize(10, 10)).toEqual({
      width: MIN_WINDOW_WIDTH,
      height: MIN_WINDOW_HEIGHT,
    });
  });

  it("clamps to the work area when the saved size is larger", () => {
    expect(clampWindowSize(3000, 2000, { width: 1440, height: 900 })).toEqual({
      width: 1440,
      height: 900,
    });
  });

  it("keeps the default size unchanged", () => {
    expect(clampWindowSize(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)).toEqual({
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
    });
  });
});

describe("contentViewBounds", () => {
  it("offsets x by the panel width and y by the title bar", () => {
    expect(
      contentViewBounds(
        { width: 1280, height: 800 },
        { collapsed: false, width: 260 },
      ),
    ).toEqual({
      x: 260,
      y: TITLE_BAR_HEIGHT,
      width: 1020,
      height: 800 - TITLE_BAR_HEIGHT,
    });
  });

  it("uses the full window width when the panel is collapsed", () => {
    expect(
      contentViewBounds(
        { width: 1280, height: 800 },
        { collapsed: true, width: 260 },
      ),
    ).toEqual({
      x: 0,
      y: TITLE_BAR_HEIGHT,
      width: 1280,
      height: 800 - TITLE_BAR_HEIGHT,
    });
  });
});

describe("sidePanelBounds", () => {
  it("covers the left edge including the title bar region", () => {
    expect(
      sidePanelBounds(
        { width: 1280, height: 800 },
        { collapsed: false, width: 260 },
      ),
    ).toEqual({ x: 0, y: 0, width: 260, height: 800 });
  });

  it("returns null when collapsed so the view can be detached", () => {
    expect(
      sidePanelBounds(
        { width: 1280, height: 800 },
        { collapsed: true, width: 260 },
      ),
    ).toBeNull();
  });
});
