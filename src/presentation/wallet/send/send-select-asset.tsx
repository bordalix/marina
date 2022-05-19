import React from 'react';
import { useHistory } from 'react-router';
import { LIGHTNING_ENTER_INVOICE_ROUTE, SEND_ADDRESS_AMOUNT_ROUTE } from '../../routes/constants';
import { useDispatch } from 'react-redux';
import { BalancesByAsset } from '../../../application/redux/selectors/balance.selector';
import { setAsset } from '../../../application/redux/actions/transaction';
import { ProxyStoreDispatch } from '../../../application/redux/proxyStore';
import { Asset } from '../../../domain/assets';
import AssetListScreen from '../../components/asset-list-screen';
import { NetworkString } from 'ldk';

export interface SendSelectAssetProps {
  network: NetworkString;
  balances: BalancesByAsset;
  balanceAssets: Array<Asset & { assetHash: string; canSubmarineSwap: boolean }>;
}

const SendSelectAssetView: React.FC<SendSelectAssetProps> = ({
  balanceAssets,
  balances,
  network,
}) => {
  const history = useHistory();
  const dispatch = useDispatch<ProxyStoreDispatch>();

  const handleSend = async (assetHash: string, isSubmarineSwap: boolean) => {
    await dispatch(setAsset(assetHash));
    const route = isSubmarineSwap ? LIGHTNING_ENTER_INVOICE_ROUTE : SEND_ADDRESS_AMOUNT_ROUTE;
    return Promise.resolve(history.push(route));
  };

  return (
    <AssetListScreen
      title="Send Asset"
      onClick={handleSend}
      assets={balanceAssets}
      balances={balances}
    />
  );
};

export default SendSelectAssetView;
