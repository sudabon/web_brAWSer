import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AccountRoleView } from "../shared/types";
import { searchAccountRoles } from "./accountSearch";

type AccountPaletteProps = {
  open: boolean;
  accounts: AccountRoleView[];
  onClose: () => void;
  onSelect: (accountRoleKey: string) => void;
};

export function AccountPalette({ open, accounts, onClose, onSelect }: AccountPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchAccountRoles(query, accounts), [query, accounts]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) {
    return null;
  }

  function choose(index: number): void {
    const item = results[index];
    if (!item) {
      return;
    }
    onSelect(item.accountRoleKey);
    onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(results.length - 1, index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="palette"
        role="dialog"
        aria-label="アカウント切替"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="アカウント名・ID・ロールで検索"
          aria-label="アカウント検索"
        />
        <ul className="palette-list">
          {results.length === 0 ? (
            <li className="placeholder">候補がありません。</li>
          ) : (
            results.map((item, index) => (
              <li key={item.accountRoleKey}>
                <button
                  type="button"
                  className={index === active ? "palette-item active" : "palette-item"}
                  onClick={() => choose(index)}
                >
                  <span className="color-dot" style={{ background: item.color }} />
                  <span>
                    <strong>{item.accountName}</strong>
                    <span className="muted">
                      {" "}
                      {item.accountId} · {item.roleName}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
