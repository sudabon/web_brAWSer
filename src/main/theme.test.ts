import { describe, expect, it } from "vitest";
import { SHELL_BACKGROUND_DARK, SHELL_BACKGROUND_LIGHT, shellBackgroundColor } from "./theme.ts";

describe("shellBackgroundColor", () => {
  it("returns the dark shell background when the system appearance is dark", () => {
    expect(shellBackgroundColor(true)).toBe(SHELL_BACKGROUND_DARK);
  });

  it("returns the light shell background when the system appearance is light", () => {
    expect(shellBackgroundColor(false)).toBe(SHELL_BACKGROUND_LIGHT);
  });
});
