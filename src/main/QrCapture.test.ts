import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { captureQrFromScreen, decodeQrBuffer, decodeQrPng } from "./QrCapture.ts";

const fixtureDir = dirname(fileURLToPath(import.meta.url));

function blockWasmNetworkFetch(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes(".wasm") || url.includes("jsdelivr") || url.includes("zxing-wasm")) {
      throw new Error(`wasm must be loaded from disk, not fetched: ${url}`);
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("QrCapture", () => {
  it("deletes the temporary PNG after a successful decode", async () => {
    const unlinked: string[] = [];
    const uri = await captureQrFromScreen({
      execFile: async () => ({ stdout: "", stderr: "" }),
      tmpdir: () => "/tmp",
      joinPath: (...parts) => parts.join("/"),
      readFile: async () => Buffer.from("png"),
      unlink: async (path) => {
        unlinked.push(path);
      },
      decodePng: async () => "otpauth://totp/AWS:alice?secret=JBSWY3DPEHPK3PXP",
    });
    expect(uri).toContain("otpauth://");
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toMatch(/brawser-totp-.*\.png$/);
  });

  it("deletes the temporary PNG after decode failure", async () => {
    const unlinked: string[] = [];
    await expect(
      captureQrFromScreen({
        execFile: async () => ({ stdout: "", stderr: "" }),
        tmpdir: () => "/tmp",
        joinPath: (...parts) => parts.join("/"),
        readFile: async () => Buffer.from("png"),
        unlink: async (path) => {
          unlinked.push(path);
        },
        decodePng: async () => {
          throw new Error("QR コードを読み取れませんでした");
        },
      }),
    ).rejects.toThrow(/読み取れませんでした/);
    expect(unlinked).toHaveLength(1);
  });

  it("treats unlink failure as an error", async () => {
    await expect(
      decodeQrBuffer(
        Buffer.from("png"),
        {
          unlink: async () => {
            throw new Error("EACCES");
          },
          decodePng: async () => "otpauth://totp/AWS:alice?secret=JBSWY3DPEHPK3PXP",
        },
        "/tmp/leftover.png",
      ),
    ).rejects.toThrow(/一時 PNG の削除に失敗/);
  });

  it("decodes a QR PNG from the local wasm binary without a network fetch", async () => {
    const restoreFetch = blockWasmNetworkFetch();
    try {
      const png = await readFile(join(fixtureDir, "fixtures/otpauth-qr.png"));
      await expect(decodeQrPng(png)).resolves.toBe(
        "otpauth://totp/AWS:alice?secret=JBSWY3DPEHPK3PXP",
      );
    } finally {
      restoreFetch();
    }
  });
});
