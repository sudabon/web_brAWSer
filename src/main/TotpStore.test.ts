import { describe, expect, it, vi } from "vitest";
import { ClipboardGuard } from "./clipboardGuard.ts";
import { TotpStore } from "./TotpStore.ts";
import type { SafeStoragePort } from "./SsoManager.ts";
import type { UnlockGate } from "./TotpStore.ts";

function xorStorage(): SafeStoragePort {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => {
      const src = Buffer.from(plain, "utf8");
      const out = Buffer.alloc(src.length);
      for (let i = 0; i < src.length; i += 1) {
        out[i] = src[i]! ^ 0x5a;
      }
      return out;
    },
    decryptString: (blob) => {
      const out = Buffer.alloc(blob.length);
      for (let i = 0; i < blob.length; i += 1) {
        out[i] = blob[i]! ^ 0x5a;
      }
      return out.toString("utf8");
    },
  };
}

function unavailableStorage(): SafeStoragePort {
  return {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error("encryption unavailable");
    },
    decryptString: () => {
      throw new Error("encryption unavailable");
    },
  };
}

function gate(allow: boolean): UnlockGate {
  return {
    canPromptBiometric: () => true,
    promptUnlock: async () => allow,
  };
}

function memoryClipboard() {
  let text = "";
  return {
    port: {
      writeText: (value: string) => {
        text = value;
      },
      readText: () => text,
      clear: () => {
        text = "";
      },
    },
    get: () => text,
  };
}

function store(overrides: Partial<ConstructorParameters<typeof TotpStore>[0]> = {}) {
  const files = new Map<string, Buffer>();
  const clip = memoryClipboard();
  const clipboard = new ClipboardGuard(clip.port, 30_000, vi.fn() as unknown as typeof setTimeout, vi.fn());
  const instance = new TotpStore({
    totpEncPath: "/tmp/totp.enc",
    safeStorage: xorStorage(),
    unlockGate: gate(true),
    clipboard,
    now: () => 59_000,
    id: () => "seed-1",
    readFile: async (path) => files.get(path) ?? null,
    writeFile: async (path, data) => {
      files.set(path, data);
    },
    ...overrides,
  });
  return { instance, files, clip };
}

describe("TotpStore", () => {
  it("encrypts seeds to totp.enc and keeps plaintext off disk", async () => {
    const { instance, files } = store();
    await instance.importUri("otpauth://totp/AWS:alice?secret=JBSWY3DPEHPK3PXP&issuer=AWS");
    const blob = files.get("/tmp/totp.enc");
    expect(blob).toBeDefined();
    expect(blob?.toString("utf8")).not.toContain("JBSWY3DPEHPK3PXP");
    const view = instance.view();
    expect(view.locked).toBe(false);
    expect(view.codes[0]?.issuer).toBe("AWS");
  });

  it("does not persist when encryption is unavailable", async () => {
    const { instance, files } = store({ safeStorage: unavailableStorage() });
    await expect(
      instance.importSecret({ issuer: "AWS", label: "alice", secret: "JBSWY3DPEHPK3PXP" }),
    ).rejects.toThrow(/暗号化/);
    expect(files.size).toBe(0);
    expect(instance.view().encryptionAvailable).toBe(false);
  });

  it("does not decrypt or show codes when unlock is cancelled", async () => {
    const files = new Map<string, Buffer>();
    const first = store({
      writeFile: async (path, data) => {
        files.set(path, data);
      },
      readFile: async (path) => files.get(path) ?? null,
    });
    await first.instance.importUri("otpauth://totp/AWS:alice?secret=JBSWY3DPEHPK3PXP");
    first.instance.lock();

    const locked = store({
      unlockGate: gate(false),
      readFile: async (path) => files.get(path) ?? null,
      writeFile: async (path, data) => {
        files.set(path, data);
      },
    });
    const ok = await locked.instance.unlock();
    expect(ok).toBe(false);
    expect(locked.instance.view().locked).toBe(true);
    expect(locked.instance.view().codes).toEqual([]);
  });

  it("clears decrypted seeds from memory on lock", async () => {
    const { instance } = store();
    await instance.importUri("otpauth://totp/AWS:alice?secret=JBSWY3DPEHPK3PXP");
    expect(instance.view().codes).toHaveLength(1);
    instance.lock();
    expect(instance.view().locked).toBe(true);
    expect(instance.view().codes).toEqual([]);
  });

  it("restores seeds after a successful unlock", async () => {
    const files = new Map<string, Buffer>();
    const first = store({
      readFile: async (path) => files.get(path) ?? null,
      writeFile: async (path, data) => {
        files.set(path, data);
      },
    });
    await first.instance.importUri("otpauth://totp/AWS:alice?secret=JBSWY3DPEHPK3PXP");
    first.instance.lock();

    const second = store({
      id: () => "seed-2",
      readFile: async (path) => files.get(path) ?? null,
      writeFile: async (path, data) => {
        files.set(path, data);
      },
    });
    expect(await second.instance.unlock()).toBe(true);
    expect(second.instance.view().codes[0]?.issuer).toBe("AWS");
  });
});
