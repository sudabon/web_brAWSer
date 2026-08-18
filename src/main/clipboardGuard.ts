export type ClipboardPort = {
  writeText(text: string): void;
  readText(): string;
  clear(): void;
};

export class ClipboardGuard {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #copied: string | undefined;

  constructor(
    private readonly clipboard: ClipboardPort,
    private readonly delayMs: number,
    private readonly setTimeoutFn: typeof setTimeout = setTimeout,
    private readonly clearTimeoutFn: typeof clearTimeout = clearTimeout,
  ) {}

  copy(text: string): void {
    if (this.#timer !== undefined) {
      this.clearTimeoutFn(this.#timer);
    }
    this.clipboard.writeText(text);
    this.#copied = text;
    this.#timer = this.setTimeoutFn(() => {
      this.#timer = undefined;
      if (this.clipboard.readText() === this.#copied) {
        this.clipboard.clear();
      }
      this.#copied = undefined;
    }, this.delayMs);
  }

  dispose(): void {
    if (this.#timer !== undefined) {
      this.clearTimeoutFn(this.#timer);
      this.#timer = undefined;
    }
  }
}
