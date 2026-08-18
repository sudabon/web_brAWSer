import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";

const require = createRequire(import.meta.url);

const execFile = promisify(execFileCallback);

export type QrCaptureDeps = {
  execFile?: (
    file: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string }>;
  tmpdir: () => string;
  joinPath: (...parts: string[]) => string;
  readFile: (path: string) => Promise<Buffer>;
  unlink: (path: string) => Promise<void>;
  decodePng?: (png: Buffer) => Promise<string>;
};

const QR_READER_OPTIONS: ReaderOptions = {
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  formats: ["QRCode"],
  maxNumberOfSymbols: 5,
};

let zxingPrepared = false;

function readLocalReaderWasm(): ArrayBuffer {
  const wasmPath = require.resolve("zxing-wasm/reader/zxing_reader.wasm");
  const bytes = readFileSync(wasmPath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function ensureZxingReaderModule(): void {
  if (zxingPrepared) {
    return;
  }
  prepareZXingModule({
    overrides: {
      wasmBinary: readLocalReaderWasm(),
    },
  });
  zxingPrepared = true;
}

export async function decodeQrPng(png: Buffer): Promise<string> {
  ensureZxingReaderModule();
  const results = await readBarcodes(png, QR_READER_OPTIONS);
  const texts = results.filter((result) => result.isValid).map((result) => result.text.trim());
  const otpauth = texts.find((text) => text.startsWith("otpauth://"));
  if (otpauth) {
    return otpauth;
  }
  if (texts.length === 0) {
    throw new Error("QR コードを読み取れませんでした");
  }
  throw new Error("QR から otpauth:// URI を抽出できませんでした");
}

export async function captureQrFromScreen(deps: QrCaptureDeps): Promise<string> {
  const path = deps.joinPath(deps.tmpdir(), `brawser-totp-${randomUUID()}.png`);
  const run = deps.execFile ?? ((file, args) => execFile(file, args));
  try {
    await run("screencapture", ["-x", "-i", path]);
  } catch {
    await unlinkQuiet(deps.unlink, path);
    throw new Error("画面範囲の選択がキャンセルされたか、キャプチャに失敗しました");
  }
  return decodeQrFile(path, deps);
}

export async function decodeQrFile(path: string, deps: QrCaptureDeps): Promise<string> {
  let png: Buffer;
  try {
    png = await deps.readFile(path);
  } catch {
    await unlinkOrThrow(deps.unlink, path);
    throw new Error("キャプチャ画像を読み込めませんでした");
  }
  return decodeQrBuffer(png, deps, path);
}

export async function decodeQrBuffer(
  png: Buffer,
  deps: Pick<QrCaptureDeps, "unlink" | "decodePng">,
  tempPath?: string,
): Promise<string> {
  const decode = deps.decodePng ?? decodeQrPng;
  let decoded: string | undefined;
  let decodeError: unknown;
  try {
    decoded = await decode(png);
  } catch (error) {
    decodeError = error;
  }
  if (tempPath) {
    await unlinkOrThrow(deps.unlink, tempPath);
  }
  if (decodeError) {
    throw decodeError instanceof Error ? decodeError : new Error(String(decodeError));
  }
  if (!decoded) {
    throw new Error("QR コードを読み取れませんでした");
  }
  return decoded;
}

async function unlinkOrThrow(unlink: (path: string) => Promise<void>, path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw new Error(`一時 PNG の削除に失敗しました: ${path}`);
  }
}

async function unlinkQuiet(unlink: (path: string) => Promise<void>, path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Capture cancel may leave no file.
  }
}
