import React from 'react';
import { useHistory } from 'react-router-dom';
import Button from '../../../components/button';
import { RECEIVE_ROUTE } from '../../../routes/constants';

interface Props {
  liquidBitcoinBalance: number;
  fiatBalance: number;
  fiatCurrency: '$' | '€';
}

/**
 * Main top component of home wallet screen
 */
const BalanceSendReceive: React.FC<Props> = ({
  liquidBitcoinBalance,
  fiatBalance,
  fiatCurrency,
}) => {
  //
  let formattedFiatBalance;
  if (fiatCurrency === '$') {
    formattedFiatBalance = `$${fiatBalance} USD`;
  } else if (fiatCurrency === '€') {
    formattedFiatBalance = `${fiatBalance} EUR`;
  }

  //
  const history = useHistory();
  const handleReceive = () => history.push(RECEIVE_ROUTE);

  return (
    <div>
      <img
        className="w-11 mt-0.5 block mx-auto mb-2"
        src="assets/images/liquid-assets/liquid-btc.svg"
        alt="liquid bitcoin logo"
      />
      <div className="mb-7">
        <p className="text-grayDark text-3xl font-medium">{liquidBitcoinBalance} L-BTC</p>
        <p className="text-grayLight text-sm font-medium">{formattedFiatBalance}</p>
      </div>
      <div className="mb-11 flex flex-row justify-center space-x-4">
        <Button className="flex flex-row items-center justify-center w-2/5" onClick={handleReceive}>
          <img className="mr-1" src="assets/images/receive.svg" alt="receive" />
          <span>Receive</span>
        </Button>
        <Button className="flex flex-row items-center justify-center w-2/5">
          <img className="mr-1" src="assets/images/send.svg" alt="send" />
          <span>Send</span>
        </Button>
      </div>
    </div>
  );
};

export default BalanceSendReceive;
