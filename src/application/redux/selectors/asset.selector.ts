import { MainAccountID } from '../../../domain/account';
import { Asset, assetGetterFromIAssets } from '../../../domain/assets';
import { RootReducerState } from '../../../domain/common';
import { lbtcAssetByNetwork } from '../../utils/network';
import { selectNetwork } from './app.selector';
import { selectBalances } from './balance.selector';

export const selectAssets = (
  state: RootReducerState
): (Asset & {
  assetHash: string;
  canSubmarineSwap: boolean;
})[] => {
  const balances = selectBalances(MainAccountID)(state);
  const network = selectNetwork(state);
  const getAsset = assetGetterFromIAssets(state.assets);
  return Object.keys(balances).map((assetHash: string) => {
    const canSubmarineSwap = [lbtcAssetByNetwork(network)].includes(assetHash);
    return {
      ...getAsset(assetHash),
      canSubmarineSwap,
    };
  });
};