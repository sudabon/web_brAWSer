import { describe, expect, it } from "vitest";
import { ACCOUNT_COLOR_BAR_HEIGHT_PX, ACCOUNT_COLOR_BAR_ID } from "../shared/accountColor.ts";
import { applyAccountColorBar, startAccountColorBar } from "./account-color-bar.ts";

class FakeElement {
  id = "";
  style: Record<string, string> = {};
  parent: FakeElement | null = null;
  children: FakeElement[] = [];
  attrs = new Map<string, string>();

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }
}

function fakeDocument(options: { documentElement?: FakeElement | null } = {}) {
  const nodes: FakeElement[] = [];
  const listeners = new Map<string, (() => void)[]>();
  return {
    documentElement:
      options.documentElement === undefined ? new FakeElement() : options.documentElement,
    defaultView: {
      MutationObserver: class {
        observe(target: unknown): void {
          // 本物と同じく、Node でないものを渡されたら投げる。
          if (!(target instanceof FakeElement)) {
            throw new TypeError(
              "Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.",
            );
          }
        }
        disconnect(): void {}
      } as unknown as typeof MutationObserver,
    },
    getElementById(id: string): FakeElement | null {
      return nodes.find((node) => node.id === id) ?? null;
    },
    createElement(): FakeElement {
      const el = new FakeElement();
      nodes.push(el);
      return el;
    },
    addEventListener(type: string, handler: () => void): void {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    emit(type: string): void {
      for (const handler of listeners.get(type) ?? []) {
        handler();
      }
    },
  };
}

describe("account color bar", () => {
  it("injects a 6px fixed bar at the top of documentElement", () => {
    const doc = fakeDocument();
    const bar = applyAccountColorBar(doc as never, "#ff0000");
    expect(bar).not.toBeNull();
    expect(bar?.id).toBe(ACCOUNT_COLOR_BAR_ID);
    expect(bar?.style.position).toBe("fixed");
    expect(bar?.style.top).toBe("0");
    expect(bar?.style.height).toBe(`${ACCOUNT_COLOR_BAR_HEIGHT_PX}px`);
    expect(bar?.style.background).toBe("#ff0000");
    expect(Number(bar?.style.zIndex)).toBeGreaterThan(1000);
    expect(doc.documentElement?.children).toContain(bar);
  });

  it("survives a preload that runs before documentElement exists", () => {
    // sandboxed preload は document 生成前に走ることがある。
    // ここで投げると preload 全体が中断し、後続の TOTP / サインイン補助まで死ぬ。
    const doc = fakeDocument({ documentElement: null });
    expect(() => startAccountColorBar(doc as never, "#ff0000", true)).not.toThrow();
  });

  it("installs the bar once the document element becomes available", () => {
    const doc = fakeDocument({ documentElement: null });
    startAccountColorBar(doc as never, "#ff0000", true);
    const documentElement = new FakeElement();
    (doc as { documentElement: FakeElement | null }).documentElement = documentElement;
    doc.emit("DOMContentLoaded");
    expect(documentElement.children).toHaveLength(1);
    expect(documentElement.children[0]?.style.background).toBe("#ff0000");
  });

  it("does not throw when no color is assigned and the document is still empty", () => {
    // SSO ポータル view は色引数を受け取らないので、この経路を通る。
    const doc = fakeDocument({ documentElement: null });
    expect(() => startAccountColorBar(doc as never, undefined, true)).not.toThrow();
  });

  it("updates an existing bar instead of duplicating it", () => {
    const doc = fakeDocument();
    applyAccountColorBar(doc as never, "#ff0000");
    applyAccountColorBar(doc as never, "#00ff00");
    expect(doc.documentElement?.children).toHaveLength(1);
    expect(doc.documentElement?.children[0]?.style.background).toBe("#00ff00");
  });
});
