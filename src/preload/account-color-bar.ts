import {
  ACCOUNT_COLOR_BAR_HEIGHT_PX,
  ACCOUNT_COLOR_BAR_ID,
} from "../shared/accountColor.ts";

export type ColorBarDocument = {
  getElementById(id: string): Element | null;
  createElement(tag: string): HTMLElement;
  /** sandboxed preload は document 生成前に走ることがあり、その間 null になる。 */
  documentElement: Element | null;
  addEventListener?(type: string, handler: () => void, options?: { once?: boolean }): void;
};

export function applyAccountColorBar(doc: ColorBarDocument, color: string): HTMLElement | null {
  if (!doc.documentElement) {
    return null;
  }
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
  let observer: MutationObserver | undefined;

  // documentElement が生えるまで observe できない。ここで投げると preload 全体が
  // 中断し、後続の TOTP / サインイン補助まで動かなくなる。
  const ensure = (): void => {
    const documentElement = doc.documentElement;
    if (!documentElement) {
      return;
    }
    if (color) {
      applyAccountColorBar(doc, color);
    }
    if (!observe || observer) {
      return;
    }
    const Observer = doc.defaultView?.MutationObserver;
    if (!Observer) {
      return;
    }
    observer = new Observer(() => {
      if (color && !doc.getElementById(ACCOUNT_COLOR_BAR_ID)) {
        applyAccountColorBar(doc, color);
      }
    });
    observer.observe(documentElement, { childList: true, subtree: true });
  };

  ensure();
  if (!doc.documentElement) {
    doc.addEventListener?.("DOMContentLoaded", ensure, { once: true });
  }

  return {
    setColor(next: string) {
      color = next;
      ensure();
    },
    disconnect() {
      observer?.disconnect();
    },
  };
}
