import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

type FindBarProps = {
  open: boolean;
  matchCount?: number;
  activeMatch?: number;
  onQuery: (query: string, findNext: boolean) => void;
  onClose: () => void;
};

export function FindBar({ open, matchCount, activeMatch, onQuery, onClose }: FindBarProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    onQuery(query, true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <form className="find-bar" onSubmit={submit}>
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          onQuery(event.target.value, false);
        }}
        onKeyDown={onKeyDown}
        placeholder="ページ内検索"
        aria-label="ページ内検索"
      />
      <span className="find-count">
        {query && matchCount !== undefined
          ? `${activeMatch ?? 0}/${matchCount}`
          : ""}
      </span>
      <button type="submit">次へ</button>
      <button type="button" onClick={onClose} aria-label="検索を閉じる">
        ×
      </button>
    </form>
  );
}
