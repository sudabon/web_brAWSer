import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import type { TotpCodeView, TotpSnapshot } from "../shared/types";
import { ChevronIcon } from "./icons";

const emptyTotp: TotpSnapshot = {
  locked: true,
  unreadable: false,
  encryptionAvailable: true,
  touchIdAvailable: true,
  seedCount: 0,
  codes: [],
};

export function TotpPanel() {
  const [open, setOpen] = useState(false);
  const [totp, setTotp] = useState<TotpSnapshot>(emptyTotp);
  const [error, setError] = useState<string | undefined>();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [uri, setUri] = useState("");
  const [issuer, setIssuer] = useState("");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [json, setJson] = useState("");
  const [dragging, setDragging] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!window.brawser?.totp) {
      return;
    }
    let cancelled = false;
    void window.brawser.totp.get().then((next) => {
      if (!cancelled) setTotp(next);
    });
    const stopChanged = window.brawser.totp.onChanged(setTotp);
    const stopToggle = window.brawser.totp.onTogglePanel(() => {
      setOpen((current) => {
        const next = !current;
        if (next) {
          void window.brawser.totp.unlock();
          sectionRef.current?.scrollIntoView({ block: "nearest" });
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
      stopChanged();
      stopToggle();
    };
  }, []);

  useEffect(() => {
    if (!open || totp.locked) {
      return;
    }
    const timer = window.setInterval(() => {
      void window.brawser.totp.get().then(setTotp);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open, totp.locked]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setError(undefined);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function onDrop(event: DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault();
    setDragging(false);
    if (totp.unreadable) {
      return;
    }
    const file = event.dataTransfer.files[0];
    if (!file) {
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    await run(() => window.brawser.totp.importImage(bytes));
  }

  async function onJsonFile(file: File | undefined): Promise<void> {
    if (!file) {
      return;
    }
    const raw = await file.text();
    await run(() => window.brawser.totp.importJson(raw));
  }

  if (!open) {
    return (
      <section className="section totp-section" aria-label="TOTP" ref={sectionRef}>
        <div className="section-heading">
          <h2>TOTP</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="TOTP を開く"
            aria-expanded={false}
            title="TOTP を開く"
            onClick={() => {
              setOpen(true);
              void window.brawser.totp.unlock();
            }}
          >
            <ChevronIcon direction="up" />
          </button>
        </div>
        <p className="placeholder">⌘⇧T で開閉します。</p>
      </section>
    );
  }

  return (
    <section className="section totp-section totp-section-open" aria-label="TOTP" ref={sectionRef}>
      <div className="section-heading">
        <h2>TOTP</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="TOTP を閉じる"
          aria-expanded={true}
          title="TOTP を閉じる"
          onClick={() => setOpen(false)}
        >
          <ChevronIcon direction="down" />
        </button>
      </div>

      <p className="totp-warning" role="note">
        ルートアカウントおよびブレークグラス用のシードは登録しないでください。このアプリはサインイン手段と
        TOTP シードを同居させます。
      </p>

      {totp.locked ? (
        <button
          type="button"
          className="text-button"
          onClick={() => void run(() => window.brawser.totp.unlock())}
        >
          {totp.touchIdAvailable ? "Touch ID で解錠" : "確認して解錠"}
        </button>
      ) : null}

      {!totp.encryptionAvailable ? (
        <p className="placeholder">暗号化が使えないため、シードは保存できません。</p>
      ) : null}

      {error || totp.errorMessage ? (
        <p className="totp-error">{error ?? totp.errorMessage}</p>
      ) : null}

      {totp.unreadable ? (
        <button
          type="button"
          className="totp-reset"
          onClick={() =>
            void run(async () => {
              const done = await window.brawser.totp.reset();
              if (done) {
                setTotp(await window.brawser.totp.get());
              }
            })
          }
        >
          リセットして再登録
        </button>
      ) : null}

      {totp.unreadable ? (
        <p className="placeholder">先にリセットしてからシードを再登録してください。</p>
      ) : totp.locked ? (
        <p className="placeholder">解錠するとコードが表示されます。</p>
      ) : totp.codes.length === 0 ? (
        <p className="placeholder">シードはまだありません。下の方法で登録してください。</p>
      ) : (
        <ul className="totp-list">
          {totp.codes.map((item) => (
            <li key={item.id}>
              <TotpCodeRow
                item={item}
                copied={copiedId === item.id}
                onCopy={() =>
                  void run(async () => {
                    await window.brawser.totp.copy(item.id);
                    setCopiedId(item.id);
                    window.setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 1500);
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}

      <fieldset className="totp-import" disabled={totp.unreadable}>
        <button
          type="button"
          className="text-button"
          onClick={() => void run(() => window.brawser.totp.captureQr())}
        >
          QR を範囲選択
        </button>

        <div
          className={dragging ? "totp-drop dragging" : "totp-drop"}
          aria-disabled={totp.unreadable}
          onDragOver={(event) => {
            event.preventDefault();
            if (!totp.unreadable) {
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => void onDrop(event)}
        >
          QR 画像をドロップ
        </div>

        <form
          className="totp-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void run(async () => {
              await window.brawser.totp.importUri(uri);
              setUri("");
            });
          }}
        >
          <label>
            otpauth URI
            <textarea
              value={uri}
              onChange={(event) => setUri(event.target.value)}
              spellCheck={false}
              rows={2}
              placeholder="otpauth://totp/..."
            />
          </label>
          <button type="submit">URI を登録</button>
        </form>

        <form
          className="totp-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void run(async () => {
              await window.brawser.totp.importSecret({ issuer, label, secret });
              setIssuer("");
              setLabel("");
              setSecret("");
            });
          }}
        >
          <label>
            発行元
            <input value={issuer} onChange={(event) => setIssuer(event.target.value)} spellCheck={false} />
          </label>
          <label>
            ラベル
            <input value={label} onChange={(event) => setLabel(event.target.value)} spellCheck={false} />
          </label>
          <label>
            Base32 シークレット
            <input
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <button type="submit">直接入力で登録</button>
        </form>

        <form
          className="totp-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void run(async () => {
              await window.brawser.totp.importJson(json);
              setJson("");
            });
          }}
        >
          <label>
            Authenticator バックアップ
            <textarea
              value={json}
              onChange={(event) => setJson(event.target.value)}
              spellCheck={false}
              rows={3}
              placeholder="JSON または otpauth URI のリスト"
            />
          </label>
          <input
            type="file"
            accept=".json,.txt,application/json,text/plain"
            onChange={(event) => void onJsonFile(event.target.files?.[0])}
          />
          <button type="submit">バックアップを取り込み</button>
        </form>
      </fieldset>
    </section>
  );
}

function TotpCodeRow({
  item,
  copied,
  onCopy,
}: {
  item: TotpCodeView;
  copied: boolean;
  onCopy: () => void;
}) {
  const ratio = item.remainingSeconds / item.period;
  return (
    <button type="button" className="totp-code" onClick={onCopy} title="クリックでコピー">
      <span
        className="totp-ring"
        style={{ background: `conic-gradient(var(--accent) ${ratio * 360}deg, var(--line) 0)` }}
        aria-label={`残り ${item.remainingSeconds} 秒`}
      />
      <span className="totp-code-body">
        <span className="totp-meta">
          {item.issuer || "TOTP"}
          {item.label ? ` · ${item.label}` : ""}
        </span>
        <span className="totp-digits">{copied ? "コピーしました" : item.code}</span>
      </span>
    </button>
  );
}
