import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { searchAwsServices } from "./serviceSearch";

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  onJump: (serviceId: string) => void;
};

export function CommandPalette({ open, onClose, onJump }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchAwsServices(query), [query]);

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
    onJump(item.id);
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
        aria-label="コマンドパレット"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="サービス名でジャンプ（S3, EC2, IAM…）"
          aria-label="サービス検索"
        />
        <ul className="palette-list">
          {results.map((service, index) => (
            <li key={service.id}>
              <button
                type="button"
                className={index === active ? "palette-item active" : "palette-item"}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span>{service.name}</span>
                <span className="muted">{service.id}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
