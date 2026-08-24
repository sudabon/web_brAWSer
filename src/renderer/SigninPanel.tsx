import { useEffect, useState, type FormEvent } from "react";
import type { SigninCredentialSnapshot } from "../shared/types";
import { ChevronIcon } from "./icons";

const emptySignin: SigninCredentialSnapshot = {
  locked: true,
  encryptionAvailable: true,
  touchIdAvailable: true,
  count: 0,
  credentials: [],
};

export function SigninPanel() {
  const [open, setOpen] = useState(false);
  const [signin, setSignin] = useState<SigninCredentialSnapshot>(emptySignin);
  const [error, setError] = useState<string | undefined>();
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!window.brawser?.credentials) {
      return;
    }
    let cancelled = false;
    void window.brawser.credentials.get().then((next) => {
      if (!cancelled) setSignin(next);
    });
    const stopChanged = window.brawser.credentials.onChanged(setSignin);
    return () => {
      cancelled = true;
      stopChanged();
    };
  }, []);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setError(undefined);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await run(async () => {
      await window.brawser.credentials.save({ label, username, password });
      setPassword("");
    });
  }

  if (!open) {
    return (
      <section className="section signin-section" aria-label="サインイン情報">
        <div className="section-heading">
          <h2>Sign-in</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Sign-in を開く"
            aria-expanded={false}
            title="Sign-in を開く"
            onClick={() => {
              setOpen(true);
              void window.brawser.credentials.unlock();
            }}
          >
            <ChevronIcon direction="up" />
          </button>
        </div>
        <p className="placeholder">
          {signin.count > 0
            ? `${signin.count} 件を保存しています。`
            : "Identity Center の ID/パスワードは未登録です。"}
        </p>
      </section>
    );
  }

  return (
    <section className="section signin-section signin-section-open" aria-label="サインイン情報">
      <div className="section-heading">
        <h2>Sign-in</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Sign-in を閉じる"
          aria-expanded={true}
          title="Sign-in を閉じる"
          onClick={() => setOpen(false)}
        >
          <ChevronIcon direction="down" />
        </button>
      </div>

      <p className="signin-warning" role="note">
        ID/パスワードと TOTP をこのアプリに同居させると、MFA は防御として機能しません。ルート
        アカウントおよびブレークグラス用の資格情報は登録しないでください。
      </p>

      {signin.locked ? (
        <button
          type="button"
          className="text-button"
          onClick={() => void run(() => window.brawser.credentials.unlock())}
        >
          {signin.touchIdAvailable ? "Touch ID で解錠" : "確認して解錠"}
        </button>
      ) : null}

      {!signin.encryptionAvailable ? (
        <p className="placeholder">暗号化が使えないため、サインイン情報は保存できません。</p>
      ) : null}

      {error || signin.errorMessage ? (
        <p className="signin-error">{error ?? signin.errorMessage}</p>
      ) : null}

      {signin.locked ? (
        <p className="placeholder">解錠すると登録済みの一覧が表示されます。</p>
      ) : signin.credentials.length === 0 ? (
        <p className="placeholder">まだ登録がありません。下のフォームから登録してください。</p>
      ) : (
        <ul className="signin-list">
          {signin.credentials.map((credential) => (
            <li key={credential.id}>
              <div className="signin-entry">
                <span className="signin-username">{credential.username}</span>
                <span className="signin-label">{credential.label || "Identity Center"}</span>
                <span className="signin-password" aria-label="保存済みパスワード">
                  ••••••••
                </span>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => void run(() => window.brawser.credentials.remove(credential.id))}
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="signin-form" onSubmit={(event) => void onSubmit(event)}>
        <label>
          ラベル（任意）
          <input
            value={label}
            placeholder="example.awsapps.com"
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label>
          ユーザー名
          <input
            value={username}
            autoComplete="off"
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label>
          パスワード
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" className="text-button" disabled={!username || !password}>
          保存する
        </button>
      </form>

      <p className="placeholder">
        サインイン画面に表示される「ID/パスワードを入力する」ボタンから入力します。送信は自動化しません。
      </p>
    </section>
  );
}
