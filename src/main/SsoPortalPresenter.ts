import { WebContentsView, type BaseWindow } from "electron";
import type { ViewBounds } from "./layout.ts";
import { attachNavigationGuard } from "./navigationHandlers.ts";
import { BROWSER_PARTITION_ARG_PREFIX } from "../shared/mfaAssist.ts";
import { SSO_PORTAL_PARTITION } from "./partition.ts";
import type { DeviceAuthPresenter } from "./SsoManager.ts";

export class SsoPortalPresenter implements DeviceAuthPresenter {
  #view: WebContentsView | null = null;

  constructor(
    private readonly options: {
      window: BaseWindow;
      awsPreloadPath: string;
      getBounds: () => ViewBounds;
      onLayout?: () => void;
    },
  ) {}

  async present(verificationUriComplete: string): Promise<void> {
    await this.dismiss();
    const view = new WebContentsView({
      webPreferences: {
        partition: SSO_PORTAL_PARTITION,
        additionalArguments: [`${BROWSER_PARTITION_ARG_PREFIX}${SSO_PORTAL_PARTITION}`],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        preload: this.options.awsPreloadPath,
      },
    });
    attachNavigationGuard(view.webContents, (url) => {
      void view.webContents.loadURL(url);
    });
    view.setBounds(this.options.getBounds());
    // index 0 = 最背面。サイドパネルを再 add すると読み込み中の WebContents が壊れる。
    this.options.window.contentView.addChildView(view, 0);
    this.#view = view;
    this.options.onLayout?.();
    await view.webContents.loadURL(verificationUriComplete);
  }

  /** 表示中のポータル view。DevTools を開く用途にのみ使う。 */
  get webContents(): WebContentsView["webContents"] | null {
    return this.#view?.webContents ?? null;
  }

  layout(): void {
    this.#view?.setBounds(this.options.getBounds());
  }

  async dismiss(): Promise<void> {
    if (!this.#view) {
      return;
    }
    this.options.window.contentView.removeChildView(this.#view);
    this.#view.webContents.close();
    this.#view = null;
    this.options.onLayout?.();
  }
}
