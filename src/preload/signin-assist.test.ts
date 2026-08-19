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
    disabled: attrs.disabled ?? false,
    readOnly: attrs.readOnly ?? false,
    value: "",
    events: [] as string[],
    focused: false,
    focus(): void {
      this.focused = true;
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

function fakeRoot(inputs: unknown[]) {
  return { querySelectorAll: () => inputs } as never;
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

  it("never mistakes the one-time-code field for the username", () => {
    const otp = fakeInput({ name: "mfaCode", autocomplete: "one-time-code" });
    const found = findSigninInputs(fakeRoot([otp]));
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
