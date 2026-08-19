import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ACCOUNT_COLORS,
  ACCOUNT_TAGS,
  DEFAULT_ACCOUNT_REGION,
  type AccountRoleView,
  type AccountTag,
  type ConsoleSessionView,
  type DirectorySnapshot,
  type PanelSnapshot,
  type TabSnapshot,
} from "../shared/types";
import { AccountPalette } from "./AccountPalette";
import { CommandPalette } from "./CommandPalette";
import { FindBar } from "./FindBar";
import { RegionPicker } from "./RegionPicker";
import { TotpPanel } from "./TotpPanel";

const emptyDirectory: DirectorySnapshot = {
  sso: { status: "unconfigured", encryptionAvailable: true },
  accounts: [],
  sessions: [],
  selectedAccountRoleKey: null,
  refreshing: false,
  reauthRequired: false,
};

function formatRemaining(ms: number | undefined): string {
  if (ms === undefined) {
    return "";
  }
  if (ms <= 0) {
    return "期限切れ";
  }
  const minutes = Math.floor(ms / 60_000);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
}

function expiryTone(ms: number | undefined): "ok" | "warn" | "expired" | undefined {
  if (ms === undefined) {
    return undefined;
  }
  if (ms <= 0) {
    return "expired";
  }
  if (ms < 10 * 60_000) {
    return "warn";
  }
  return "ok";
}

function groupAccounts(accounts: AccountRoleView[]): {
  accountId: string;
  accountName: string;
  color: string;
  tags: AccountTag[];
  defaultRegion: string;
  roles: AccountRoleView[];
}[] {
  const groups: {
    accountId: string;
    accountName: string;
    color: string;
    tags: AccountTag[];
    defaultRegion: string;
    roles: AccountRoleView[];
  }[] = [];
  const index = new Map<string, number>();
  for (const account of accounts) {
    const existing = index.get(account.accountId);
    if (existing === undefined) {
      index.set(account.accountId, groups.length);
      groups.push({
        accountId: account.accountId,
        accountName: account.accountName,
        color: account.color,
        tags: account.tags,
        defaultRegion: account.defaultRegion,
        roles: [account],
      });
    } else {
      groups[existing]?.roles.push(account);
    }
  }
  return groups;
}

function TabListItem({
  tab,
  prodWarning,
  accountColor,
}: {
  tab: TabSnapshot;
  prodWarning: boolean;
  accountColor?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.title);
  const cancelled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) {
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  function startRename(): void {
    cancelled.current = false;
    setDraft(tab.title);
    setEditing(true);
  }

  function commit(): void {
    if (cancelled.current) {
      return;
    }
    setEditing(false);
    void window.brawser.tabs.rename(tab.id, draft);
  }

  function onRenameKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelled.current = true;
      setEditing(false);
      setDraft(tab.title);
    }
  }

  const titleClass = tab.hibernated ? "tab-title hibernated" : "tab-title";
  const colorDot = accountColor ? (
    <span className="color-dot filled" style={{ background: accountColor }} />
  ) : null;

  return (
    <li>
      {editing ? (
        <div className={tab.active ? "tab-item active" : "tab-item"}>
          {colorDot}
          {tab.favicon ? (
            <img className="tab-favicon" src={tab.favicon} alt="" />
          ) : (
            <span className="tab-favicon placeholder-favicon" />
          )}
          {prodWarning ? (
            <span className="tab-warning" aria-label="prod アカウント">
              ⚠
            </span>
          ) : null}
          <input
            ref={inputRef}
            className="tab-title-edit"
            value={draft}
            maxLength={80}
            aria-label="タブ名を編集"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={onRenameKeyDown}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : (
        <button
          type="button"
          className={tab.active ? "tab-item active" : "tab-item"}
          onClick={() => void window.brawser.tabs.select(tab.id)}
          onDoubleClick={(event) => {
            event.preventDefault();
            startRename();
          }}
          title={`${tab.title}\n${tab.url}\nダブルクリックで名前を変更`}
        >
          {colorDot}
          {tab.favicon ? (
            <img className="tab-favicon" src={tab.favicon} alt="" />
          ) : (
            <span className="tab-favicon placeholder-favicon" />
          )}
          {prodWarning ? (
            <span className="tab-warning" aria-label="prod アカウント">
              ⚠
            </span>
          ) : null}
          <span className={titleClass}>{tab.title || tab.url}</span>
        </button>
      )}
      <button
        type="button"
        className="tab-close"
        aria-label={`${tab.title} を閉じる`}
        onClick={() => void window.brawser.tabs.close(tab.id)}
      >
        ×
      </button>
    </li>
  );
}

export function SidePanel() {
  const [tabs, setTabs] = useState<TabSnapshot[]>([]);
  const [panel, setPanel] = useState<PanelSnapshot>({
    collapsed: false,
    width: 260,
  });
  const [directory, setDirectory] = useState<DirectorySnapshot>(emptyDirectory);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [regionOpen, setRegionOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findResult, setFindResult] = useState<{ matches: number; activeMatch: number }>({
    matches: 0,
    activeMatch: 0,
  });
  const [hibernateMinutes, setHibernateMinutes] = useState(30);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [startUrl, setStartUrl] = useState("");
  const [region, setRegion] = useState(DEFAULT_ACCOUNT_REGION);

  useEffect(() => {
    if (!window.brawser?.tabs) {
      return;
    }
    let cancelled = false;
    void window.brawser.tabs.list().then((next) => {
      if (!cancelled) setTabs(next);
    });
    void window.brawser.panel.getState().then((next) => {
      if (!cancelled) setPanel(next);
    });
    void window.brawser.directory.get().then((next) => {
      if (!cancelled) {
        setDirectory(next);
        if (next.sso.startUrl) setStartUrl(next.sso.startUrl);
        if (next.sso.region) setRegion(next.sso.region);
      }
    });
    const stopTabs = window.brawser.tabs.onChanged(setTabs);
    const stopPanel = window.brawser.panel.onChanged(setPanel);
    const stopDirectory = window.brawser.directory.onChanged(setDirectory);
    const stopPalette = window.brawser.directory.onPaletteOpen(() => setPaletteOpen(true));
    const stopCommand = window.brawser.commands.onOpen(() => setCommandOpen(true));
    const stopRegion = window.brawser.region.onOpen(() => setRegionOpen(true));
    const stopFindOpen = window.brawser.find.onOpen(() => setFindOpen(true));
    const stopFindResult = window.brawser.find.onResult(setFindResult);
    void window.brawser.workspace.get().then((workspace) => {
      if (!cancelled) {
        setHibernateMinutes(Math.round(workspace.hibernateAfterMs / 60_000));
      }
    });
    return () => {
      cancelled = true;
      stopTabs();
      stopPanel();
      stopDirectory();
      stopPalette();
      stopCommand();
      stopRegion();
      stopFindOpen();
      stopFindResult();
    };
  }, []);

  const sessions = useMemo(() => {
    const map = new Map<string, ConsoleSessionView>();
    for (const session of directory.sessions) {
      map.set(session.accountRoleKey, session);
    }
    return map;
  }, [directory.sessions]);

  const groups = useMemo(() => groupAccounts(directory.accounts), [directory.accounts]);
  const selectedKey = directory.selectedAccountRoleKey;
  const selectedAccount = directory.accounts.find((account) => account.accountRoleKey === selectedKey);

  async function onConfigureSso(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = startUrl.trim();
    if (!trimmed) {
      return;
    }
    await window.brawser.directory.configureSso({ startUrl: trimmed, region });
  }

  function onResizePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    target.setPointerCapture(pointerId);
    const onMove = (moveEvent: PointerEvent): void => {
      void window.brawser.panel.setWidth(moveEvent.clientX);
    };
    const onUp = (): void => {
      target.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      className="panel"
      style={
        selectedAccount
          ? { borderLeftColor: selectedAccount.color, ["--account-color" as string]: selectedAccount.color }
          : undefined
      }
    >
      <header className="panel-titlebar">
        <span className="app-name">WEBbrAWSer</span>
        <button
          type="button"
          className="icon-button"
          onClick={() => setPaletteOpen(true)}
          aria-label="アカウント切替パレットを開く"
        >
          ⌘
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => void window.brawser.panel.setCollapsed(!panel.collapsed)}
          aria-label="サイドパネルを折りたたむ"
        >
          ⟨
        </button>
      </header>

      <section className="section sso-section" aria-label="SSO セッション">
        <SsoStatusBar
          directory={directory}
          startUrl={startUrl}
          region={region}
          onStartUrl={setStartUrl}
          onRegion={setRegion}
          onConfigure={onConfigureSso}
        />
        <label className="hibernate-setting">
          ハイバネート（分）
          <input
            type="number"
            min={5}
            max={240}
            value={hibernateMinutes}
            onChange={(event) => setHibernateMinutes(Number(event.target.value) || 30)}
            onBlur={() => {
              const ms = Math.max(5, hibernateMinutes) * 60_000;
              void window.brawser.workspace.setHibernateAfterMs(ms);
            }}
          />
        </label>
        <button
          type="button"
          className="text-button"
          onClick={() => void window.brawser.urlHandoff.registerProtocol()}
        >
          AWS URL の受け取りを登録
        </button>
      </section>

      <section className="section account-section" aria-label="アカウント">
        <div className="section-heading">
          <h2>Accounts</h2>
          <button
            type="button"
            className={directory.refreshing ? "icon-button spinning" : "icon-button"}
            onClick={() => void window.brawser.directory.refresh()}
            disabled={directory.refreshing || directory.sso.status !== "signed-in"}
            aria-label={directory.refreshing ? "アカウント一覧を更新中" : "アカウント一覧を更新"}
            title="アカウント一覧を更新"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M13.2 8A5.2 5.2 0 1 1 11.4 3.7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path d="M13.5 1.8v3.4H10.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        {groups.length === 0 ? (
          <p className="placeholder">
            {directory.sso.status === "signed-in"
              ? "アカウントはまだありません。"
              : "SSO にサインインするとアカウント一覧が表示されます。"}
          </p>
        ) : (
          <ul className="account-tree">
            {groups.map((group) => (
              <li key={group.accountId} className="account-group">
                <div className="account-group-header">
                  <span className="account-name">{group.accountName}</span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setEditingAccountId((current) =>
                        current === group.accountId ? null : group.accountId,
                      )
                    }
                  >
                    設定
                  </button>
                </div>
                {editingAccountId === group.accountId ? (
                  <AccountSettingsEditor
                    accountId={group.accountId}
                    color={group.color}
                    tags={group.tags}
                    defaultRegion={group.defaultRegion}
                  />
                ) : null}
                <ul>
                  {group.roles.map((role) => {
                    const session = sessions.get(role.accountRoleKey);
                    const connected = Boolean(session?.connected);
                    const tone = expiryTone(session?.remainingMs);
                    const selected = selectedKey === role.accountRoleKey;
                    return (
                      <li key={role.accountRoleKey}>
                        <button
                          type="button"
                          className={
                            selected ? `account-role selected tone-${tone ?? "ok"}` : `account-role tone-${tone ?? "idle"}`
                          }
                          onClick={() => void window.brawser.directory.connect(role.accountRoleKey)}
                        >
                          <span
                            className={connected ? "color-dot filled" : "color-dot outline"}
                            style={
                              connected
                                ? { background: role.color }
                                : { borderColor: role.color }
                            }
                          />
                          <span className="role-label">
                            <span>{role.roleName}</span>
                            {session ? (
                              <span className="remaining">{formatRemaining(session.remainingMs)}</span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section tab-section" aria-label="タブ">
        <h2>Tabs</h2>
        <FindBar
          open={findOpen}
          matchCount={findResult.matches}
          activeMatch={findResult.activeMatch}
          onQuery={(query, findNext) => {
            void window.brawser.find.query(query, findNext);
          }}
          onClose={() => {
            setFindOpen(false);
            void window.brawser.find.stop();
          }}
        />
        <ul className="tab-list">
          {tabs.length === 0 ? (
            <li className="placeholder">タブはまだありません。</li>
          ) : (
            tabs.map((tab) => {
              const account = directory.accounts.find(
                (item) => item.accountRoleKey === tab.accountRoleKey,
              );
              const prodWarning = account?.tags.includes("prod") ?? false;
              return (
                <TabListItem
                  key={tab.id}
                  tab={tab}
                  prodWarning={prodWarning}
                  accountColor={account?.color}
                />
              );
            })
          )}
        </ul>
      </section>

      <TotpPanel />

      <div
        className="resize-handle"
        onPointerDown={onResizePointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="サイドパネルの幅を変更"
      />

      <AccountPalette
        open={paletteOpen}
        accounts={directory.accounts}
        onClose={() => {
          setPaletteOpen(false);
          void window.brawser.urlHandoff.cancelPending();
        }}
        onSelect={(accountRoleKey) => {
          void (async () => {
            const pending = await window.brawser.urlHandoff.takePending();
            if (pending) {
              await window.brawser.urlHandoff.openInAccount(accountRoleKey, pending);
              return;
            }
            await window.brawser.directory.connect(accountRoleKey);
          })();
        }}
      />
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        onJump={(serviceId) => {
          void window.brawser.commands.jump(serviceId);
        }}
      />
      <RegionPicker
        open={regionOpen}
        currentRegion={selectedAccount?.defaultRegion}
        onClose={() => setRegionOpen(false)}
        onSelect={(region) => {
          void window.brawser.region.switchTo(region);
        }}
      />
    </div>
  );
}

function SsoStatusBar({
  directory,
  startUrl,
  region,
  onStartUrl,
  onRegion,
  onConfigure,
}: {
  directory: DirectorySnapshot;
  startUrl: string;
  region: string;
  onStartUrl: (value: string) => void;
  onRegion: (value: string) => void;
  onConfigure: (event: FormEvent) => Promise<void>;
}) {
  const { sso } = directory;
  if (sso.status === "unconfigured") {
    return (
      <form className="sso-form" onSubmit={(event) => void onConfigure(event)}>
        <h2>SSO</h2>
        <label>
          Start URL
          <input
            value={startUrl}
            onChange={(event) => onStartUrl(event.target.value)}
            placeholder="https://d-xxxxxxxx.awsapps.com/start"
            spellCheck={false}
          />
        </label>
        <label>
          Region
          <input
            value={region}
            onChange={(event) => onRegion(event.target.value)}
            spellCheck={false}
          />
        </label>
        <button type="submit">サインイン</button>
      </form>
    );
  }

  return (
    <div className="sso-status">
      <h2>SSO</h2>
      <p className={`sso-remaining tone-${expiryTone(sso.remainingMs) ?? "ok"}`}>
        {sso.status === "authorizing" && "Identity Center で承認してください"}
        {sso.status === "signed-in" &&
          `残り ${formatRemaining(sso.remainingMs) || "—"}`}
        {sso.status === "signed-out" && "セッションがありません"}
        {sso.status === "error" && (sso.errorMessage ?? "SSO エラー")}
      </p>
      {!sso.encryptionAvailable ? (
        <p className="placeholder">暗号化が使えないため、SSO トークンは再起動後に保持されません。</p>
      ) : null}
      {directory.reauthRequired ? (
        <p className="placeholder">{directory.reauthMessage}</p>
      ) : null}
      {sso.status !== "signed-in" && sso.status !== "authorizing" ? (
        <button
          type="button"
          className="text-button"
          onClick={() => void window.brawser.directory.startAuth()}
        >
          サインイン
        </button>
      ) : null}
    </div>
  );
}

function AccountSettingsEditor({
  accountId,
  color,
  tags,
  defaultRegion,
}: {
  accountId: string;
  color: string;
  tags: AccountTag[];
  defaultRegion: string;
}) {
  const [region, setRegion] = useState(defaultRegion);

  async function save(patch: {
    color?: string;
    tags?: AccountTag[];
    defaultRegion?: string;
  }): Promise<void> {
    await window.brawser.directory.updateAccount({ accountId, ...patch });
  }

  return (
    <div className="account-settings">
      <div className="color-row">
        {ACCOUNT_COLORS.map((value) => (
          <button
            key={value}
            type="button"
            className={value === color ? "swatch selected" : "swatch"}
            style={{ background: value }}
            aria-label={`色 ${value}`}
            onClick={() => void save({ color: value })}
          />
        ))}
      </div>
      <div className="tag-row">
        {ACCOUNT_TAGS.map((tag) => {
          const on = tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              className={on ? "tag selected" : "tag"}
              onClick={() => {
                const next = on ? tags.filter((item) => item !== tag) : [...tags, tag];
                void save({ tags: next });
              }}
            >
              {tag}
            </button>
          );
        })}
      </div>
      <label>
        既定リージョン
        <input
          value={region}
          onChange={(event) => setRegion(event.target.value)}
          onBlur={() => {
            if (region.trim() && region !== defaultRegion) {
              void save({ defaultRegion: region.trim() });
            }
          }}
          spellCheck={false}
        />
      </label>
    </div>
  );
}
