import { App } from '../domain/app/app';
import { appInitState, walletInitState } from '../application/store/reducers';
import { assetInitState } from '../application/store/reducers/asset-reducer';
import { IWallet, Wallet } from '../domain/wallet/wallet';
import { Repositories } from '../domain/common';

/**
 * Init browser storage at extension installation
 * @param repos
 */
export async function initPersistentStore(repos: Repositories): Promise<void> {
  const app = App.createApp(appInitState);
  const wallets = walletInitState.map((w: IWallet) => Wallet.createWallet(w));
  await Promise.all([
    repos.app.init(app),
    repos.assets.init(assetInitState),
    repos.txsHistory.init({ regtest: {}, liquid: {} }),
    repos.wallet.init(wallets),
  ]);
}