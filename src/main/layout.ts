export const TITLE_BAR_HEIGHT = 38;
export const DEFAULT_PANEL_WIDTH = 260;
export const MIN_PANEL_WIDTH = 180;
export const MAX_PANEL_WIDTH = 480;
export const DEFAULT_WINDOW_WIDTH = 1280;
export const DEFAULT_WINDOW_HEIGHT = 800;
export const MIN_WINDOW_WIDTH = 800;
export const MIN_WINDOW_HEIGHT = 600;

export type PanelLayoutState = {
  collapsed: boolean;
  width: number;
};

export type ViewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function clampPanelWidth(width: number): number {
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(width)));
}

export function clampWindowSize(
  width: number,
  height: number,
  workArea?: { width: number; height: number },
): { width: number; height: number } {
  const maxWidth = workArea?.width ?? Number.POSITIVE_INFINITY;
  const maxHeight = workArea?.height ?? Number.POSITIVE_INFINITY;
  return {
    width: Math.min(maxWidth, Math.max(MIN_WINDOW_WIDTH, Math.round(width))),
    height: Math.min(maxHeight, Math.max(MIN_WINDOW_HEIGHT, Math.round(height))),
  };
}

export function contentViewBounds(
  windowSize: { width: number; height: number },
  panel: PanelLayoutState,
  titleBarHeight = TITLE_BAR_HEIGHT,
): ViewBounds {
  const x = panel.collapsed ? 0 : panel.width;
  const y = titleBarHeight;
  return {
    x,
    y,
    width: Math.max(0, windowSize.width - x),
    height: Math.max(0, windowSize.height - y),
  };
}

export function sidePanelBounds(
  windowSize: { width: number; height: number },
  panel: PanelLayoutState,
): ViewBounds | null {
  if (panel.collapsed) {
    return null;
  }
  return {
    x: 0,
    y: 0,
    width: panel.width,
    height: windowSize.height,
  };
}
