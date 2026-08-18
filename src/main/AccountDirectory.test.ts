import { describe, expect, it } from "vitest";
import { ConfigStore } from "./ConfigStore.ts";
import { AccountDirectory } from "./AccountDirectory.ts";
import type { SsoGateway } from "./FederationService.ts";

describe("AccountDirectory", () => {
  it("returns cached views immediately and refreshes from SSO in the background", async () => {
    const store = new ConfigStore("/tmp/unused");
    await store.saveDirectoryCache([
      { accountId: "111", accountName: "cached", roleNames: ["Admin"] },
    ]);
    const gateway: SsoGateway = {
      async listAccounts() {
        return { accountList: [{ accountId: "222", accountName: "fresh" }] };
      },
      async listAccountRoles() {
        return { roleList: [{ roleName: "ReadOnly" }] };
      },
      async getRoleCredentials() {
        throw new Error("unused");
      },
    };
    const directory = new AccountDirectory(store, () => gateway);

    expect(directory.views()[0]?.accountName).toBe("cached");
    const refreshed = await directory.refresh("token");
    expect(refreshed[0]).toMatchObject({
      accountId: "222",
      accountName: "fresh",
      roleName: "ReadOnly",
    });
  });
});
