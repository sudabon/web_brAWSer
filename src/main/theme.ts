export const SHELL_BACKGROUND_DARK = "#161618";
export const SHELL_BACKGROUND_LIGHT = "#f3f3f5";

export function shellBackgroundColor(dark: boolean): string {
  return dark ? SHELL_BACKGROUND_DARK : SHELL_BACKGROUND_LIGHT;
}
