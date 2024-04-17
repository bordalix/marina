import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router';
import ShellPopUp from '../../components/shell-popup';
import Button from '../../components/button';
import { SEND_PAYMENT_SUCCESS_ROUTE } from '../../routes/constants';
import { formatAddress, toSatoshi } from '../../utility';
import { useStorageContext } from '../../context/storage-context';
import { Boltz } from '../../../pkg/boltz';
import { AccountFactory, MainAccount, MainAccountTest } from '../../../application/account';
import QRCode from 'qrcode.react';

const LightningShowInvoice: React.FC = () => {
  const history = useHistory();
  const { appRepository, receiveFlowRepository, walletRepository, cache } = useStorageContext();
  const [errors, setErrors] = useState({ amount: '', submit: '' });
  const [invoice, setInvoice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lookingForPayment, setIsLookingForPayment] = useState(false);
  const [buttonText, setButtonText] = useState('Copy');
  const [isInvoiceExpanded, setisInvoiceExpanded] = useState(false);

  const network = cache?.network ?? 'liquid';
  const boltz = new Boltz(network);

  let invoiceExpirationTimeout: NodeJS.Timeout;

  const invoiceHasExpired = async () => {
    setErrors({ submit: 'Invoice has expired', amount: '' });
    setIsSubmitting(false);
    setIsLookingForPayment(false);
    await receiveFlowRepository.reset();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(invoice).then(
      () => setButtonText('Copied'),
      (err) => console.error('Could not copy text: ', err)
    );
  };

  const handleBackBtn = () => history.goBack();

  const handleCompletion = (txhex: string) => {
    clearTimeout(invoiceExpirationTimeout);
    history.push({
      pathname: SEND_PAYMENT_SUCCESS_ROUTE,
      state: { txhex, text: 'Payment received!' },
    });
  };

  const handleInvoice = (invoice: string) => {
    const invoiceExpireDate = Number(boltz.getInvoiceExpireDate(invoice));
    if (invoiceExpireDate < Date.now()) return invoiceHasExpired();
    invoiceExpirationTimeout = setTimeout(invoiceHasExpired, invoiceExpireDate - Date.now());
    setIsSubmitting(false);
    setInvoice(invoice);
  };

  const makeSwap = async () => {
    const swapAmount = await receiveFlowRepository.getAmount();
    if (!swapAmount) throw new Error('No amount defined');

    // get account
    const accountFactory = await AccountFactory.create(walletRepository);
    const accountName = network === 'liquid' ? MainAccount : MainAccountTest;
    const mainAccount = await accountFactory.make(network, accountName);

    // get alternative address
    const addr = await mainAccount.getNextAddress(false);

    // create reverse submarine swap
    await boltz.reverseSwap(
      toSatoshi(swapAmount),
      addr.confidentialAddress,
      handleCompletion,
      handleInvoice
    );

    // in the case we are receiving from another boltz wallet, the
    // payment will be a Liquid payment, and we need to wait for in on chain
    const chainSource = await appRepository.getChainSource(network);
    if (!chainSource) throw new Error('Chain source not found for network ' + network);

    await chainSource.waitForAddressReceivesTx(addr.confidentialAddress);

    const histories = await chainSource.fetchHistories([Buffer.from(addr.script, 'hex')]);
    for (const history of histories) {
      const newTx = history.find((tx) => tx.height <= 0);
      if (newTx) {
        const txs = await chainSource.fetchTransactions([newTx.tx_hash]);
        const fullTx = txs.find((t) => t.txID === newTx.tx_hash);
        if (fullTx) handleCompletion(fullTx.hex);
      }
    }
  };

  useEffect(() => {
    setIsSubmitting(true);
    setIsLookingForPayment(true);
    void makeSwap();
  }, []);

  const AuxiliarButton = ({ children }: { children: React.ReactNode }) => (
    <button
      className="text-primary focus:outline-none text-xs font-medium"
      onClick={() => setisInvoiceExpanded(!isInvoiceExpanded)}
    >
      {children}
    </button>
  );

  return (
    <ShellPopUp
      backBtnCb={isSubmitting || lookingForPayment ? handleBackBtn : undefined}
      backgroundImagePath="/assets/images/popup/bg-sm.png"
      className="h-popupContent bg-primary flex items-center justify-center bg-bottom bg-no-repeat"
      currentPage="Receive⚡️"
    >
      <div className="w-80 h-96 rounded-4xl flex flex-col items-center justify-between px-10 py-4 mx-auto bg-white">
        <p className="mb-2 text-xs font-medium whitespace-pre">⏳ Waiting for payment...</p>
        <p className="mb-4 text-xs font-medium whitespace-pre">Don't close this window</p>
        {isInvoiceExpanded ? (
          <>
            <p className="text-xs font-medium break-all">{invoice}</p>
            <AuxiliarButton>Show QR Code</AuxiliarButton>
          </>
        ) : (
          <>
            <QRCode size={176} value={invoice.toLowerCase()} />
            <p className="font-regular mt-4 text-lg">{formatAddress(invoice)}</p>
            <AuxiliarButton>Expand</AuxiliarButton>
          </>
        )}
        {errors.submit && (
          <p className="text-red mt-1 text-xs font-medium text-left">{errors.submit}</p>
        )}
        <Button className="w-3/5 mt-4" onClick={handleCopy}>
          <span className="text-base antialiased font-bold">{buttonText}</span>
        </Button>
      </div>
    </ShellPopUp>
  );
};

export default LightningShowInvoice;
