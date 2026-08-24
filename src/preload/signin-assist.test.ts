import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fillSigninInputs, findSigninInputs } from "./signin-assist.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

type FakeInputAttrs = {
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  placeholder?: string;
  ariaLabel?: string;
  wrappingLabelText?: string;
  maxLength?: number;
  disabled?: boolean;
  readOnly?: boolean;
  width?: number;
  height?: number;
};

function fakeInput(attrs: FakeInputAttrs = {}) {
  return {
    type: attrs.type ?? "text",
    name: attrs.name ?? "",
    id: attrs.id ?? "",
    autocomplete: attrs.autocomplete ?? "",
    placeholder: attrs.placeholder ?? "",
    maxLength: attrs.maxLength ?? -1,
    disabled: attrs.disabled ?? false,
    readOnly: attrs.readOnly ?? false,
    value: "",
    events: [] as string[],
    focused: false,
    ownerDocument: null as unknown,
    focus(): void {
      this.focused = true;
    },
    getAttribute(name: string): string | null {
      return name === "aria-label" ? (attrs.ariaLabel ?? null) : null;
    },
    closest(selector: string): { textContent: string } | null {
      return selector === "label" && attrs.wrappingLabelText
        ? { textContent: attrs.wrappingLabelText }
        : null;
    },
    dispatchEvent(event: { type: string }): boolean {
      this.events.push(event.type);
      return true;
    },
    getBoundingClientRect: () => ({
      width: attrs.width ?? 220,
      height: attrs.height ?? 32,
      top: 100,
      right: 320,
    }),
  };
}

/** Cloudscape のように `label[for]` で入力欄に文言が紐づくページを模す。 */
function fakeRoot(inputs: unknown[], labelsByInputId: Record<string, string> = {}) {
  const doc = {
    querySelectorAll: () => inputs,
    getElementById: () => null,
    querySelector: (selector: string) => {
      const label = /^label\[for="(.*)"\]$/.exec(selector);
      if (label) {
        const text = labelsByInputId[label[1]];
        return text ? { textContent: text } : null;
      }
      const maxLength = /^input\[type="text"\]\[maxlength="(\d+)"\]$/.exec(selector);
      if (maxLength) {
        return (
          (inputs as { type: string; maxLength: number }[]).find(
            (input) => input.type === "text" && input.maxLength === Number(maxLength[1]),
          ) ?? null
        );
      }
      return null;
    },
  };
  for (const input of inputs as { ownerDocument: unknown }[]) {
    input.ownerDocument = doc;
  }
  return doc as never;
}

describe("findSigninInputs", () => {
  it("classifies the username and password fields of a sign-in form", () => {
    const username = fakeInput({ name: "username", autocomplete: "username" });
    const password = fakeInput({ type: "password", name: "password" });
    const found = findSigninInputs(fakeRoot([username, password]));
    expect(found.username).toBe(username);
    expect(found.password).toBe(password);
  });

  it("finds the password alone when the form asks for it on its own step", () => {
    const password = fakeInput({ type: "password", id: "awsui-input-1" });
    const found = findSigninInputs(fakeRoot([password]));
    expect(found.username).toBeNull();
    expect(found.password).toBe(password);
  });

  it("finds the username alone when the form asks for it on its own step", () => {
    const username = fakeInput({ type: "email", id: "email-input" });
    const found = findSigninInputs(fakeRoot([username]));
    expect(found.username).toBe(username);
    expect(found.password).toBeNull();
  });

  it("finds the Cloudscape username field, which is named only by its label", () => {
    // 実測 (ap-northeast-1.signin.aws の login ステップ):
    // type=text / name="" / id="awsui-input-0" / autocomplete="on" で、
    // 手がかりは <label for="awsui-input-0">ユーザー名</label> だけ。
    const username = fakeInput({ type: "text", id: "awsui-input-0", autocomplete: "on" });
    const found = findSigninInputs(fakeRoot([username], { "awsui-input-0": "ユーザー名" }));
    expect(found.username).toBe(username);
    expect(found.password).toBeNull();
  });

  it("rejects the Cloudscape one-time-code field, which is also named only by its label", () => {
    const otp = fakeInput({ type: "text", id: "awsui-input-0", autocomplete: "on" });
    const found = findSigninInputs(fakeRoot([otp], { "awsui-input-0": "認証コード" }));
    expect(found.username).toBeNull();
    expect(found.password).toBeNull();
  });

  it("reads the label from aria-label and from a wrapping label element", () => {
    const byAria = fakeInput({ ariaLabel: "Username" });
    expect(findSigninInputs(fakeRoot([byAria])).username).toBe(byAria);
    const byWrapper = fakeInput({ wrappingLabelText: "メールアドレス" });
    expect(findSigninInputs(fakeRoot([byWrapper])).username).toBe(byWrapper);
  });

  it("never mistakes the one-time-code field for the username", () => {
    const otp = fakeInput({ name: "mfaCode", autocomplete: "one-time-code" });
    const found = findSigninInputs(fakeRoot([otp]));
    expect(found.username).toBeNull();
    expect(found.password).toBeNull();
  });

  it("never claims an input that the TOTP assist detects as the one-time-code field", () => {
    // ラベル文言が想定外でも、OTP 欄と判定された要素は構造的に除外する。
    const otp = fakeInput({ type: "text", id: "awsui-input-0", maxLength: 6 });
    const found = findSigninInputs(fakeRoot([otp], { "awsui-input-0": "ユーザー名" }));
    expect(found.username).toBeNull();
    expect(found.password).toBeNull();
  });

  it("skips hidden, disabled and collapsed inputs", () => {
    const hidden = fakeInput({ type: "hidden", name: "username" });
    const disabled = fakeInput({ name: "username", disabled: true });
    const readOnly = fakeInput({ name: "username", readOnly: true });
    const collapsed = fakeInput({ name: "username", width: 0, height: 0 });
    const found = findSigninInputs(fakeRoot([hidden, disabled, readOnly, collapsed]));
    expect(found.username).toBeNull();
  });
});

describe("fillSigninInputs", () => {
  it("writes both values and notifies the page", () => {
    const username = fakeInput({ name: "username" });
    const password = fakeInput({ type: "password", name: "password" });
    fillSigninInputs({ username, password } as never, {
      username: "alice",
      password: "s3cret-pass",
    });
    expect(username.value).toBe("alice");
    expect(password.value).toBe("s3cret-pass");
    expect(username.events).toEqual(["input", "change"]);
    expect(password.events).toEqual(["input", "change"]);
  });

  it("fills only the field the current step shows", () => {
    const password = fakeInput({ type: "password", name: "password" });
    fillSigninInputs({ username: null, password } as never, {
      username: "alice",
      password: "s3cret-pass",
    });
    expect(password.value).toBe("s3cret-pass");
    expect(password.focused).toBe(true);
  });
});

describe("signin assist preload contract", () => {
  it("does not submit the form on the user's behalf", async () => {
    const source = await readFile(join(repoRoot, "src/preload/signin-assist.ts"), "utf8");
    expect(source).not.toMatch(/\.submit\s*\(/);
    expect(source).not.toMatch(/requestSubmit/);
    expect(source).toMatch(/入力する/);
  });

  it("only offers to fill on the Identity Center sign-in page", async () => {
    const source = await readFile(join(repoRoot, "src/preload/signin-assist.ts"), "utf8");
    expect(source).toMatch(/shouldAssistMfa/);
  });
});
