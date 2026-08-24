import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppController } from "./AppController.ts";

async function tempController(): Promise<AppController> {
  const dir = await mkdtemp(join(tmpdir(), "brawser-controller-"));
  return new AppController({
    userDataDir: dir,
    ssoEncPath: join(dir, "sso.enc"),
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (plain) => Buffer.from(plain),
      decryptString: (blob) => blob.toString(),
    },
    presenter: { present: async () => {}, dismiss: async () => {} },
    tabs: {
      openTab: () => "tab-1",
      focusAccount: () => {},
      tabsFor: () => [],
      navigateTab: () => {},
    },
    onChange: () => {},
  });
}

describe("AppController.updateAccount", () => {
  it("carries the pin flag through to the stored account settings", async () => {
    const controller = await tempController();
    await controller.updateAccount({ accountId: "111111111111", pinned: true });
    expect(controller.config.settingsFor("111111111111").pinned).toBe(true);
  });

  it("leaves untouched fields alone", async () => {
    const controller = await tempController();
    await controller.updateAccount({ accountId: "111111111111", defaultRegion: "us-east-1" });
    await controller.updateAccount({ accountId: "111111111111", pinned: true });
    const settings = controller.config.settingsFor("111111111111");
    expect(settings.defaultRegion).toBe("us-east-1");
    expect(settings.pinned).toBe(true);
  });
});
