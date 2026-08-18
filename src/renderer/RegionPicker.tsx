import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CONSOLE_REGIONS } from "../shared/regions";

type RegionPickerProps = {
  open: boolean;
  currentRegion?: string;
  onClose: () => void;
  onSelect: (region: string) => void;
};

export function RegionPicker({ open, currentRegion, onClose, onSelect }: RegionPickerProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = CONSOLE_REGIONS.filter((region) =>
    region.includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setActive(Math.max(0, CONSOLE_REGIONS.indexOf(currentRegion as (typeof CONSOLE_REGIONS)[number])));
    inputRef.current?.focus();
  }, [open, currentRegion]);

  if (!open) {
    return null;
  }

  function choose(index: number): void {
    const region = results[index];
    if (!region) {
      return;
    }
    onSelect(region);
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
        aria-label="リージョン切替"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="リージョン"
          aria-label="リージョン検索"
        />
        <ul className="palette-list">
          {results.map((region, index) => (
            <li key={region}>
              <button
                type="button"
                className={index === active ? "palette-item active" : "palette-item"}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
              >
                {region}
                {region === currentRegion ? <span className="muted">現在</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
