import { describe, expect, it } from "vitest";
import { ACCOUNT_COLOR_BAR_HEIGHT_PX, ACCOUNT_COLOR_BAR_ID } from "../shared/accountColor.ts";
import { applyAccountColorBar } from "./account-color-bar.ts";

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

function fakeDocument() {
  const documentElement = new FakeElement();
  const nodes: FakeElement[] = [];
  return {
    documentElement,
    getElementById(id: string): FakeElement | null {
      return nodes.find((node) => node.id === id) ?? null;
    },
    createElement(): FakeElement {
      const el = new FakeElement();
      nodes.push(el);
      return el;
    },
  };
}

describe("account color bar", () => {
  it("injects a 6px fixed bar at the top of documentElement", () => {
    const doc = fakeDocument();
    const bar = applyAccountColorBar(doc as never, "#ff0000");
    expect(bar.id).toBe(ACCOUNT_COLOR_BAR_ID);
    expect(bar.style.position).toBe("fixed");
    expect(bar.style.top).toBe("0");
    expect(bar.style.height).toBe(`${ACCOUNT_COLOR_BAR_HEIGHT_PX}px`);
    expect(bar.style.background).toBe("#ff0000");
    expect(Number(bar.style.zIndex)).toBeGreaterThan(1000);
    expect(doc.documentElement.children).toContain(bar);
  });

  it("updates an existing bar instead of duplicating it", () => {
    const doc = fakeDocument();
    applyAccountColorBar(doc as never, "#ff0000");
    applyAccountColorBar(doc as never, "#00ff00");
    expect(doc.documentElement.children).toHaveLength(1);
    expect(doc.documentElement.children[0]?.style.background).toBe("#00ff00");
  });
});
