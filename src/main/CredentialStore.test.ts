import { describe, expect, it } from "vitest";
import { CredentialStore } from "./CredentialStore.ts";
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

function store(
  overrides: Partial<ConstructorParameters<typeof CredentialStore>[0]> = {},
  files = new Map<string, Buffer>(),
) {
  const instance = new CredentialStore({
    credentialsEncPath: "/tmp/creds.enc",
    safeStorage: xorStorage(),
    unlockGate: gate(true),
    id: () => "cred-1",
    readFile: async (path) => files.get(path) ?? null,
    writeFile: async (path, data) => {
      files.set(path, data);
    },
    ...overrides,
  });
  return { instance, files };
}

const alice = { label: "example.awsapps.com", username: "alice", password: "s3cret-pass" };

describe("CredentialStore", () => {
  it("encrypts credentials to creds.enc and keeps the password off disk", async () => {
    const { instance, files } = store();
    await instance.save(alice);
    const blob = files.get("/tmp/creds.enc");
    expect(blob).toBeDefined();
    expect(blob?.toString("utf8")).not.toContain("s3cret-pass");
    expect(blob?.toString("utf8")).not.toContain("alice");
  });

  it("never exposes the password through the snapshot", async () => {
    const { instance } = store();
    await instance.save(alice);
    const view = instance.view();
    expect(view.credentials).toEqual([
      { id: "cred-1", label: "example.awsapps.com", username: "alice" },
    ]);
    expect(JSON.stringify(view)).not.toContain("s3cret-pass");
  });

  it("does not persist when encryption is unavailable", async () => {
    const { instance, files } = store({ safeStorage: unavailableStorage() });
    await expect(instance.save(alice)).rejects.toThrow(/暗号化/);
    expect(files.size).toBe(0);
    expect(instance.view().encryptionAvailable).toBe(false);
  });

  it("does not decrypt when unlock is cancelled", async () => {
    const files = new Map<string, Buffer>();
    const first = store({}, files);
    await first.instance.save(alice);

    const locked = store({ unlockGate: gate(false) }, files);
    expect(await locked.instance.unlock()).toBe(false);
    expect(locked.instance.view().locked).toBe(true);
    expect(locked.instance.view().credentials).toEqual([]);
  });

  it("clears decrypted credentials from memory on lock", async () => {
    const { instance } = store();
    await instance.save(alice);
    expect(instance.view().credentials).toHaveLength(1);
    instance.lock();
    expect(instance.view().locked).toBe(true);
    expect(instance.view().credentials).toEqual([]);
    await expect(instance.currentForAssist()).resolves.toEqual({
      username: "alice",
      password: "s3cret-pass",
    });
  });

  it("restores credentials after a successful unlock", async () => {
    const files = new Map<string, Buffer>();
    const first = store({}, files);
    await first.instance.save(alice);
    first.instance.lock();

    const second = store({ id: () => "cred-2" }, files);
    expect(await second.instance.unlock()).toBe(true);
    expect(second.instance.view().credentials[0]?.username).toBe("alice");
  });

  it("updates the stored password instead of duplicating the same account", async () => {
    const { instance } = store();
    await instance.save(alice);
    await instance.save({ ...alice, password: "rotated-pass" });
    expect(instance.view().credentials).toHaveLength(1);
    await expect(instance.currentForAssist()).resolves.toEqual({
      username: "alice",
      password: "rotated-pass",
    });
  });

  it("removes a credential", async () => {
    const { instance } = store();
    await instance.save(alice);
    await instance.remove("cred-1");
    expect(instance.view().credentials).toEqual([]);
    expect(instance.view().count).toBe(0);
  });

  it("refuses to fill when nothing is registered", async () => {
    const { instance } = store();
    await expect(instance.currentForAssist()).rejects.toThrow(/登録/);
  });

  it("refuses to fill when unlock is cancelled", async () => {
    const files = new Map<string, Buffer>();
    const first = store({}, files);
    await first.instance.save(alice);

    const locked = store({ unlockGate: gate(false) }, files);
    await expect(locked.instance.currentForAssist()).rejects.toThrow();
  });
});
