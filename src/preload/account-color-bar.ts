import {
  ACCOUNT_COLOR_BAR_HEIGHT_PX,
  ACCOUNT_COLOR_BAR_ID,
} from "../shared/accountColor.ts";

export type ColorBarDocument = {
  getElementById(id: string): Element | null;
  createElement(tag: string): HTMLElement;
  documentElement: Element;
};

export function applyAccountColorBar(doc: ColorBarDocument, color: string): HTMLElement {
  const existing = doc.getElementById(ACCOUNT_COLOR_BAR_ID);
  const bar = (existing as HTMLElement | null) ?? doc.createElement("div");
  bar.id = ACCOUNT_COLOR_BAR_ID;
  bar.setAttribute("data-brawser-account-color", color);
  bar.style.position = "fixed";
  bar.style.top = "0";
  bar.style.left = "0";
  bar.style.right = "0";
  bar.style.width = "100%";
  bar.style.height = `${ACCOUNT_COLOR_BAR_HEIGHT_PX}px`;
  bar.style.background = color;
  bar.style.zIndex = "2147483647";
  bar.style.pointerEvents = "none";
  if (!existing) {
    doc.documentElement.appendChild(bar);
  }
  return bar;
}

export function startAccountColorBar(
  doc: ColorBarDocument & {
    defaultView?: { MutationObserver?: typeof MutationObserver } | null;
  },
  initialColor: string | undefined,
  observe: boolean,
): { setColor(color: string): void; disconnect(): void } {
  let color = initialColor ?? "";
  if (color) {
    applyAccountColorBar(doc, color);
  }

  const Observer = doc.defaultView?.MutationObserver;
  const observer =
    observe && Observer
      ? new Observer(() => {
          if (color && !doc.getElementById(ACCOUNT_COLOR_BAR_ID)) {
            applyAccountColorBar(doc, color);
          }
        })
      : undefined;
  observer?.observe(doc.documentElement, { childList: true, subtree: true });

  return {
    setColor(next: string) {
      color = next;
      applyAccountColorBar(doc, next);
    },
    disconnect() {
      observer?.disconnect();
    },
  };
}
