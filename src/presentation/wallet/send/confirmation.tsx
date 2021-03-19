import React, { useContext } from 'react';
import { useLocation, useHistory } from 'react-router';
import { AppContext } from '../../../application/store/context';
import Button from '../../components/button';
import ShellPopUp from '../../components/shell-popup';
import { SEND_CHOOSE_FEE_ROUTE, SEND_END_OF_FLOW_ROUTE } from '../../routes/constants';
import { imgPathMapMainnet, imgPathMapRegtest } from '../../../application/utils';
import { fromSatoshiStr } from '../../utils';
import { Address } from '../../../domain/wallet/value-objects';

interface LocationState {
  changeAddress: Address;
}

const Confirmation: React.FC = () => {
  const [{ wallets, app, assets }] = useContext(AppContext);
  const { state } = useLocation<LocationState>();
  const history = useHistory();

  // In case the home btn is pressed prevents to use pendingTx's props
  if (!wallets[0].pendingTx) {
    return <></>;
  }

  const { sendAddress, sendAsset, sendAmount, feeAsset, feeAmount } = wallets[0].pendingTx;

  const handleSend = () => history.push(SEND_END_OF_FLOW_ROUTE);
  const handleBackBtn = () => {
    if (state?.changeAddress) {
      history.push({
        pathname: SEND_CHOOSE_FEE_ROUTE,
        state: { changeAddress: state.changeAddress },
      });
    }
  };

  return (
    <ShellPopUp
      backBtnCb={handleBackBtn}
      backgroundImagePath="/assets/images/popup/bg-sm.png"
      className="h-popupContent container pb-20 mx-auto text-center bg-bottom bg-no-repeat"
      currentPage="Confirmation"
    >
      <h1 className="text-2xl">{assets[app.network.value][sendAsset]?.name}</h1>
      <img
        className="w-11 mt-0.5 block mx-auto mb-2"
        src={
          app.network.value === 'regtest'
            ? imgPathMapRegtest[assets[app.network.value][sendAsset]?.ticker] ??
              imgPathMapRegtest['']
            : imgPathMapMainnet[sendAsset] ?? imgPathMapMainnet['']
        }
        alt="liquid asset logo"
      />

      <div className="px-3 mt-3">
        <h2 className="text-lg font-medium text-left">To</h2>
        <p className="font-regular text-sm text-left break-all">{sendAddress}</p>
      </div>

      <div className="bg-gradient-to-r from-secondary to-primary flex flex-row items-center justify-between h-12 px-4 mt-4 rounded-full">
        <span className="text-lg font-medium">Amount</span>
        <span className="text-base font-medium text-white">
          {fromSatoshiStr(sendAmount)} {assets[app.network.value][sendAsset]?.ticker}
        </span>
      </div>

      <div className="flex flex-row items-end justify-between px-3 mt-10">
        <span className="text-lg font-medium">Fee</span>
        <span className="font-regular text-base">
          {fromSatoshiStr(feeAmount)} {assets[app.network.value][feeAsset]?.ticker}
        </span>
      </div>

      <Button className="bottom-20 right-8 absolute" onClick={handleSend}>
        Send
      </Button>
    </ShellPopUp>
  );
};

export default Confirmation;