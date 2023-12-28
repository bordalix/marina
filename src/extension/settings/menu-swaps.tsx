import React, { useState } from 'react';
import { useHistory } from 'react-router';
import ShellPopUp from '../components/shell-popup';
import Button from '../components/button';
import cx from 'classnames';
import * as ecc from 'tiny-secp256k1';
import { extractErrorMessage } from '../utility/error';
import zkp from '@vulpemventures/secp256k1-zkp';
import { Boltz, boltzUrl } from '../../pkg/boltz';
import { address, networks } from 'liquidjs-lib';
import { useStorageContext } from '../context/storage-context';
import { SEND_PAYMENT_SUCCESS_ROUTE } from '../routes/constants';
import type { ECPairInterface } from 'ecpair';
import ECPairFactory from 'ecpair';
import type { SwapParams } from '../../domain/repository';
import { AccountFactory, MainAccount, MainAccountTest } from '../../application/account';
import BIP32Factory from 'bip32';
import { toBlindingData } from 'liquidjs-lib/src/psbt';
import { decrypt } from '../../domain/encryption';
import { mnemonicToSeed } from 'bip39';
import ButtonsAtBottom from '../components/buttons-at-bottom';
import { toOutputScript } from 'liquidjs-lib/src/address';

const zkpLib = await zkp();
const bip32 = BIP32Factory(ecc);

// TODO

const SettingsMenuSwaps: React.FC = () => {
  const history = useHistory();
  const { cache, appRepository, walletRepository } = useStorageContext();

  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [swapParams, setSwapParams] = useState<SwapParams>();
  const [touched, setTouched] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const network = cache?.network ?? 'liquid';
  const boltz = new Boltz(boltzUrl[network], networks[network].assetHash, zkpLib);

  // 1. find the derivation path
  // TODO: maybe have cache
  // 2. Ask user for password to fetch the private key
  // 3. Decrypt the unspent to blinding data

  const findDerivationPath = async (refundPublicKey: string): Promise<string> => {
    // get account
    const accountFactory = await AccountFactory.create(walletRepository);
    const accountName = network === 'liquid' ? MainAccount : MainAccountTest;
    const mainAccount = await accountFactory.make(network, accountName);
    // find address
    const [usedAddress] = (await mainAccount.getAllAddresses()).filter(
      (a) => a.publicKey === refundPublicKey
    );
    if (!usedAddress.derivationPath)
      throw new Error('derivation path not found for pubkey ' + refundPublicKey);
    return usedAddress.derivationPath;
  };

  const getKeyPairFromDerivationPath = async (
    derivationPath: string,
    password: string
  ): Promise<ECPairInterface> => {
    const encrypted = await walletRepository.getEncryptedMnemonic();
    if (!encrypted) throw new Error('No mnemonic found in wallet');
    const decryptedMnemonic = await decrypt(encrypted, password);
    const masterNode = bip32.fromSeed(await mnemonicToSeed(decryptedMnemonic));
    const key = masterNode.derivePath(derivationPath.replace('m/', '')!);
    return ECPairFactory(ecc).fromPrivateKey(key.privateKey!);
  };

  const handleJsonChange = async (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setError('');
    setTouched(true);

    try {
      const json = JSON.parse(event.target.value);
      if (!json.blindingKey) throw new Error('Invalid JSON: missing blindingKey');
      if (!json.redeemScript) throw new Error('Invalid JSON: missing redeemScript');
      if (!json.network) json.network = network;

      const { blindingKey, fundingAddress, redeemScript, refundPublicKey, timeoutBlockHeight } =
        boltz.extractInfoFromSwapParams(json);

      const derivationPath = await findDerivationPath(refundPublicKey);

      setSwapParams({
        blindingKey,
        derivationPath,
        fundingAddress,
        network: json.network,
        redeemScript,
        refundPublicKey,
        timeoutBlockHeight,
      });
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const handlePasswordChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setIsSubmitting(false);
    setPasswordError('');
    setPassword(event.target.value);
  };

  const handleProceed = async () => {
    setIsSubmitting(true);
    try {
      if (!swapParams) throw new Error('No swapParams');

      const chainSource = await appRepository.getChainSource(network);
      if (!chainSource) throw new Error('Chain source not found for network ' + network);

      const {
        blindingKey,
        derivationPath,
        fundingAddress,
        redeemScript,
        refundPublicKey,
        timeoutBlockHeight,
      } = swapParams;

      if (!derivationPath) return setError('Unable to find derivation path');
      if (!fundingAddress) return setError('Unable to find funding address');
      if (!refundPublicKey) return setError('Unable to find refund public key');

      // get key pair
      const refundKeyPair = await getKeyPairFromDerivationPath(derivationPath, password);
      if (!refundKeyPair) return setError('Unable to get key pair');

      // fetch utxos for address
      const [utxo] = await chainSource.listUnspents(fundingAddress);
      if (!utxo) return setError('Unable to find UTXO (already spent?)');

      // unblind utxo
      const { asset, assetBlindingFactor, value, valueBlindingFactor } = await toBlindingData(
        Buffer.from(blindingKey, 'hex'),
        utxo.witnessUtxo
      );
      utxo['blindingData'] = {
        asset: asset.reverse().toString('hex'),
        assetBlindingFactor: assetBlindingFactor.toString('hex'),
        value: parseInt(value, 10),
        valueBlindingFactor: valueBlindingFactor.toString('hex'),
      };

      const accountFactory = await AccountFactory.create(walletRepository);
      const accountName = network === 'liquid' ? MainAccount : MainAccountTest;
      const mainAccount = await accountFactory.make(network, accountName);
      const addr = await mainAccount.getNextAddress(false);
      const blindingPublicKey = address.fromConfidential(addr.confidentialAddress).blindingKey;
      const destinationScript = toOutputScript(addr.confidentialAddress).toString('hex');

      const refundTransaction = boltz.makeRefundTransaction({
        utxo,
        refundKeyPair,
        redeemScript: Buffer.from(redeemScript, 'hex'),
        timeoutBlockHeight,
        destinationScript: Buffer.from(destinationScript, 'hex'),
        blindingPublicKey,
      });

      await chainSource.broadcastTransaction(refundTransaction.toHex());

      history.push({
        pathname: SEND_PAYMENT_SUCCESS_ROUTE,
        state: { txhex: refundTransaction.toHex(), text: 'Payment received!' },
      });
    } catch (err) {
      setPasswordError(extractErrorMessage(err));
    }
  };

  return (
    <ShellPopUp className="h-popupContent" currentPage="Refund swap">
      <div className="w-full h-full p-10 bg-white">
        <form className="mt-2">
          <div>
            <label className="block">
              <p className="mb-2 text-base font-medium text-left">JSON</p>
              <textarea
                rows={4}
                id="json"
                name="json"
                onChange={handleJsonChange}
                className={cx('border-2 focus:border-primary block w-full rounded-md', {
                  'border-red': error && touched,
                  'border-grayLight': !error || touched,
                })}
              />
            </label>
          </div>
          {error && touched && (
            <p className="text-red mt-1 text-xs font-medium text-left">{error}</p>
          )}
          {touched && !error && (
            <>
              <p className="mt-10 mb-2 font-medium text-left">Password</p>
              <input
                name="password"
                placeholder="Password"
                type="password"
                onChange={handlePasswordChange}
              />
            </>
          )}
          {passwordError && (
            <p className="text-red mt-1 text-xs font-medium text-left">{passwordError}</p>
          )}
          <ButtonsAtBottom>
            <Button
              className="w-3/5 mt-6 text-base"
              disabled={Boolean(!touched || error || isSubmitting)}
              onClick={handleProceed}
            >
              Proceed
            </Button>
          </ButtonsAtBottom>
        </form>
      </div>
    </ShellPopUp>
  );
};

export default SettingsMenuSwaps;
