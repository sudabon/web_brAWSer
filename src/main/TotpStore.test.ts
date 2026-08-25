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

function throwingDecryptStorage(): SafeStoragePort {
  const xor = xorStorage();
  return {
    isEncryptionAvailable: () => true,
    encryptString: xor.encryptString,
    decryptString: () => {
      throw new Error(
        "Error while decrypting the ciphertext provided to safeStorage.decryptString.",
      );
    },
  };
}

function switchableDecryptStorage(decryptOk: { current: boolean }): SafeStoragePort {
  const xor = xorStorage();
  return {
    isEncryptionAvailable: () => true,
    encryptString: xor.encryptString,
    decryptString: (blob) => {
      if (!decryptOk.current) {
        throw new Error(
          "Error while decrypting the ciphertext provided to safeStorage.decryptString.",
        );
      }
      return xor.decryptString(blob);
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

function fileOps(files: Map<string, Buffer>) {
  return {
    readFile: async (path: string) => files.get(path) ?? null,
    writeFile: async (path: string, data: Buffer) => {
      files.set(path, data);
    },
    renameFile: async (from: string, to: string) => {
      const data = files.get(from);
      if (data === undefined) {
        throw new Error(`ENOENT: ${from}`);
      }
      files.set(to, data);
      files.delete(from);
    },
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
    ...fileOps(files),
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

  it("marks vault unreadable when decryptString throws", async () => {
    const files = new Map<string, Buffer>();
    files.set("/tmp/totp.enc", Buffer.from("ciphertext"));
    const { instance } = store({
      safeStorage: throwingDecryptStorage(),
      readFile: async (path) => files.get(path) ?? null,
      writeFile: async (path, data) => {
        files.set(path, data);
      },
    });
    expect(await instance.unlock()).toBe(false);
    const view = instance.view();
    expect(view.unreadable).toBe(true);
    expect(view.locked).toBe(true);
    expect(view.seedCount).toBe(0);
    expect(view.codes).toEqual([]);
    expect(view.errorMessage).toMatch(/鍵が変わった|リセットして再登録/);
  });

  it("does not mark vault unreadable when unlock is cancelled", async () => {
    const files = new Map<string, Buffer>();
    files.set("/tmp/totp.enc", Buffer.from("ciphertext"));
    const { instance } = store({
      unlockGate: gate(false),
      safeStorage: throwingDecryptStorage(),
      readFile: async (path) => files.get(path) ?? null,
      writeFile: async (path, data) => {
        files.set(path, data);
      },
    });
    expect(await instance.unlock()).toBe(false);
    expect(instance.view().unreadable).toBe(false);
    expect(instance.view().locked).toBe(true);
  });

  it("does not delete or overwrite totp.enc when decrypt fails", async () => {
    const files = new Map<string, Buffer>();
    const original = Buffer.from("ciphertext");
    files.set("/tmp/totp.enc", original);
    const { instance } = store({
      safeStorage: throwingDecryptStorage(),
      readFile: async (path) => files.get(path) ?? null,
      writeFile: async (path, data) => {
        files.set(path, data);
      },
    });
    await instance.unlock();
    expect(files.get("/tmp/totp.enc")?.equals(original)).toBe(true);
  });

  it("clears unreadable and shows codes after decrypt recovers", async () => {
    const files = new Map<string, Buffer>();
    const decryptOk = { current: true };
    const { instance } = store({
      safeStorage: switchableDecryptStorage(decryptOk),
      readFile: async (path) => files.get(path) ?? null,
      writeFile: async (path, data) => {
        files.set(path, data);
      },
    });
    await instance.importUri("otpauth://totp/AWS:alice?secret=JBSWY3DPEHPK3PXP&issuer=AWS");
    instance.lock();

    decryptOk.current = false;
    expect(await instance.unlock()).toBe(false);
    expect(instance.view().unreadable).toBe(true);
    expect(instance.view().codes).toEqual([]);

    decryptOk.current = true;
    expect(await instance.unlock()).toBe(true);
    expect(instance.view().unreadable).toBe(false);
    expect(instance.view().locked).toBe(false);
    expect(instance.view().codes[0]?.issuer).toBe("AWS");
  });

  it("rejects imports while unreadable and leaves totp.enc unchanged", async () => {
    const files = new Map<string, Buffer>();
    const original = Buffer.from("ciphertext");
    files.set("/tmp/totp.enc", original);
    const { instance } = store({
      safeStorage: throwingDecryptStorage(),
      readFile: async (path) => files.get(path) ?? null,
      writeFile: async (path, data) => {
        files.set(path, data);
      },
    });
    await instance.unlock();

    await expect(
      instance.importUri("otpauth://totp/AWS:alice?secret=JBSWY3DPEHPK3PXP&issuer=AWS"),
    ).rejects.toThrow(/リセット/);
    await expect(
      instance.importSecret({ issuer: "AWS", label: "alice", secret: "JBSWY3DPEHPK3PXP" }),
    ).rejects.toThrow(/リセット/);
    await expect(instance.importBackup("otpauth://totp/AWS:bob?secret=JBSWY3DPEHPK3PXP&issuer=AWS")).rejects.toThrow(
      /リセット/,
    );
    expect(files.get("/tmp/totp.enc")?.equals(original)).toBe(true);
  });

  it("backs up totp.enc and unlocks an empty vault on reset while unreadable", async () => {
    const files = new Map<string, Buffer>();
    const original = Buffer.from("ciphertext");
    files.set("/tmp/totp.enc", original);
    const { instance } = store({
      safeStorage: throwingDecryptStorage(),
      ...fileOps(files),
    });
    await instance.unlock();
    await instance.reset();
    expect(files.get("/tmp/totp.enc")).toBeUndefined();
    expect(files.get("/tmp/totp.enc.bak.59000")?.equals(original)).toBe(true);
    const view = instance.view();
    expect(view.unreadable).toBe(false);
    expect(view.locked).toBe(false);
    expect(view.seedCount).toBe(0);
    expect(view.errorMessage).toBeUndefined();
  });

  it("creates totp.enc with the current key after reset and import", async () => {
    const files = new Map<string, Buffer>();
    files.set("/tmp/totp.enc", Buffer.from("ciphertext"));
    const { instance } = store({
      safeStorage: throwingDecryptStorage(),
      ...fileOps(files),
    });
    await instance.unlock();
    await instance.reset();
    await instance.importUri("otpauth://totp/AWS:alice?secret=JBSWY3DPEHPK3PXP&issuer=AWS");
    expect(files.get("/tmp/totp.enc")).toBeDefined();
    expect(instance.view().codes[0]?.issuer).toBe("AWS");
    expect(instance.view().unreadable).toBe(false);
  });

  it("does not reset when the vault is readable", async () => {
    const { instance, files } = store();
    await instance.importUri("otpauth://totp/AWS:alice?secret=JBSWY3DPEHPK3PXP&issuer=AWS");
    const original = files.get("/tmp/totp.enc");
    expect(original).toBeDefined();
    await instance.reset();
    expect(files.get("/tmp/totp.enc")?.equals(original!)).toBe(true);
    expect(instance.view().seedCount).toBe(1);
  });

  it("does not throw when reset is called without totp.enc", async () => {
    const files = new Map<string, Buffer>();
    files.set("/tmp/totp.enc", Buffer.from("ciphertext"));
    const { instance } = store({
      safeStorage: throwingDecryptStorage(),
      ...fileOps(files),
    });
    await instance.unlock();
    files.delete("/tmp/totp.enc");
    await expect(instance.reset()).resolves.toBeUndefined();
    expect(instance.view().unreadable).toBe(false);
    expect(instance.view().locked).toBe(false);
  });

  it("notifies onChange after reset", async () => {
    const onChange = vi.fn();
    const files = new Map<string, Buffer>();
    files.set("/tmp/totp.enc", Buffer.from("ciphertext"));
    const { instance } = store({
      safeStorage: throwingDecryptStorage(),
      onChange,
      ...fileOps(files),
    });
    await instance.unlock();
    onChange.mockClear();
    await instance.reset();
    expect(onChange).toHaveBeenCalled();
  });
});
