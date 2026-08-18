import { ConfigStore } from "./ConfigStore.ts";
import {
  listAccountsWithRoles,
  type AccountWithRoles,
  type SsoGateway,
} from "./FederationService.ts";
import type { AccountRoleView } from "../shared/types.ts";

export class AccountDirectory {
  constructor(
    private readonly store: ConfigStore,
    private readonly gateway: () => SsoGateway,
  ) {}

  views(): AccountRoleView[] {
    return this.store.mergeAccounts(this.store.cachedAccounts());
  }

  async refresh(accessToken: string): Promise<AccountRoleView[]> {
    const accounts: AccountWithRoles[] = await listAccountsWithRoles(
      accessToken,
      this.gateway(),
    );
    await this.store.saveDirectoryCache(accounts);
    return this.store.mergeAccounts(accounts);
  }
}
