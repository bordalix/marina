import type { TagData } from 'bolt11';
import bolt11 from 'bolt11';
import { address, crypto, script } from 'liquidjs-lib';
import type { NetworkString } from 'marina-provider';
import { AccountFactory, MainAccount, MainAccountTest } from '../application/account';
import type { WalletRepository } from './repository';
import Decimal from 'decimal.js';

interface CreateSwapCommonRequest {
  type: 'submarine' | 'reversesubmarine';
  pairId: 'L-BTC/BTC';
  orderSide: 'buy' | 'sell';
}

interface CreateSwapCommonResponse {
  id: string;
  timeoutBlockHeight: number;
}

export type SubmarineSwapRequest = {
  invoice: string;
  refundPublicKey: string;
};

export type ReverseSubmarineSwapRequest = {
  preimageHash: string;
  onchainAmount: number;
  claimPublicKey: string;
};

export type SubmarineSwapResponse = {
  acceptZeroConf: boolean;
  address: string;
  bip21: string;
  blindingKey: string;
  expectedAmount: number;
  id: string;
  redeemScript: string;
  timeoutBlockHeight: number;
};

export type ReverseSubmarineSwapResponse = {
  blindingKey: string;
  id: string;
  invoice: string;
  lockupAddress: string;
  onchainAmount: number;
  redeemScript: string;
  timeoutBlockHeight: number;
};

export type GetPairResponse = {
  hash: string;
  rate: number;
  limits: {
    maximal: number;
    minimal: number;
    maximalZeroConf: {
      baseAsset: number;
      quoteAsset: number;
    };
  };
  fees: {
    percentage: number;
    percentageSwapIn: number;
    minerFees: {
      baseAsset: {
        normal: number;
        reverse: {
          claim: number;
          lockup: number;
        };
      };
      quoteAsset: {
        normal: number;
        reverse: {
          claim: number;
          lockup: number;
        };
      };
    };
  };
};

export const boltzUrl: Record<NetworkString, string> = {
  regtest: 'http://localhost:9090',
  testnet: 'https://testnet.boltz.exchange/api',
  liquid: 'https://api.boltz.exchange',
};

export default class Boltz {
  url: string;
  constructor(network: NetworkString) {
    this.url = boltzUrl[network];
  }

  createSubmarineSwap = async (
    req: SubmarineSwapRequest
  ): Promise<CreateSwapCommonResponse & SubmarineSwapResponse> => {
    const base: CreateSwapCommonRequest = {
      type: 'submarine',
      pairId: 'L-BTC/BTC',
      orderSide: 'sell',
    };
    const params: CreateSwapCommonRequest & SubmarineSwapRequest = {
      ...base,
      ...req,
    };
    return this.callCreateSwap(params);
  };

  createReverseSubmarineSwap = async (
    req: ReverseSubmarineSwapRequest
  ): Promise<CreateSwapCommonResponse & ReverseSubmarineSwapResponse> => {
    const base: CreateSwapCommonRequest = {
      type: 'reversesubmarine',
      pairId: 'L-BTC/BTC',
      orderSide: 'buy',
    };
    const params: CreateSwapCommonRequest & ReverseSubmarineSwapRequest = {
      ...base,
      ...req,
    };
    return this.callCreateSwap(params);
  };

  getPair = async (pair: string): Promise<GetPairResponse | undefined> => {
    const data = await this.getApi(`${this.url}/getpairs`);
    if (!data?.pairs?.[pair]) return;
    return data.pairs[pair];
  };

  private callCreateSwap = async (
    params: CreateSwapCommonRequest
  ): Promise<CreateSwapCommonResponse & any> => {
    return this.postApi(`${this.url}/createswap`, params);
  };

  private getApi = async (url: string): Promise<any> => {
    const res = await fetch(url);
    if (!res.ok) {
      const errorMessage = await res.text();
      throw new Error(`${res.statusText}: ${errorMessage}`);
    }
    return await res.json();
  };

  private postApi = async (url: string, params: any = {}): Promise<any> => {
    const res = await fetch(url, {
      body: JSON.stringify(params),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!res.ok) {
      const errorMessage = await res.text();
      throw new Error(`${res.statusText}: ${errorMessage}`);
    }
    return await res.json();
  };
}

export const DEFAULT_LIGHTNING_LIMITS = { maximal: 0.04294967, minimal: 0.0005 };

// Submarine swaps

// validates redeem script is in expected template
const validSwapReedemScript = (redeemScript: string, refundPublicKey: string) => {
  const scriptAssembly = script
    .toASM(script.decompile(Buffer.from(redeemScript, 'hex')) || [])
    .split(' ');
  const boltzHash = scriptAssembly[4];
  const cltv = scriptAssembly[6];
  const preimageHash = scriptAssembly[1];
  const expectedScript = [
    'OP_HASH160',
    preimageHash,
    'OP_EQUAL',
    'OP_IF',
    boltzHash,
    'OP_ELSE',
    cltv,
    'OP_NOP2',
    'OP_DROP',
    refundPublicKey,
    'OP_ENDIF',
    'OP_CHECKSIG',
  ];
  return scriptAssembly.join() === expectedScript.join();
};

export const isValidSubmarineSwap = (redeemScript: string, refundPublicKey: string): boolean =>
  validSwapReedemScript(redeemScript, refundPublicKey);

// Reverse submarine swaps

// validates if invoice has correct payment hash tag
const correctPaymentHashInInvoice = (invoice: string, preimage: Buffer) => {
  const paymentHash = getInvoiceTag(invoice, 'payment_hash');
  const preimageHash = crypto.sha256(preimage).toString('hex');
  return paymentHash === preimageHash;
};

// validates if reverse swap address derives from redeem script
const reverseSwapAddressDerivesFromScript = (lockupAddress: string, redeemScript: string) => {
  const addressScript = address.toOutputScript(lockupAddress);
  const addressScriptASM = script.toASM(script.decompile(addressScript) || []);
  const sha256 = crypto.sha256(Buffer.from(redeemScript, 'hex')).toString('hex');
  const expectedAddressScriptASM = `OP_0 ${sha256}`; // P2SH
  return addressScriptASM === expectedAddressScriptASM;
};

export const isValidReverseSubmarineSwap = (
  invoice: string,
  lockupAddress: string,
  preimage: Buffer,
  pubKey: string,
  redeemScript: string
): boolean => {
  return (
    correctPaymentHashInInvoice(invoice, preimage) &&
    reverseSwapAddressDerivesFromScript(lockupAddress, redeemScript) &&
    validReverseSwapReedemScript(preimage, pubKey, redeemScript)
  );
};

export const getInvoiceTag = (invoice: string, tag: string): TagData => {
  const decodedInvoice = bolt11.decode(invoice);
  for (const { tagName, data } of decodedInvoice.tags) {
    if (tagName === tag) return data;
  }
  return '';
};

export const getInvoiceValue = (invoice: string): number => {
  const { satoshis, millisatoshis } = bolt11.decode(invoice);
  if (satoshis) return satoshis;
  if (millisatoshis) return Decimal.div(millisatoshis, 1000).toNumber();
  return 0;
};

export const getInvoiceExpireDate = (invoice: string): number => {
  const { timeExpireDate } = bolt11.decode(invoice);
  return timeExpireDate ? timeExpireDate * 1000 : 0; // milliseconds
};

// validates if we can redeem with this redeem script
const validReverseSwapReedemScript = (preimage: Buffer, pubKey: string, redeemScript: string) => {
  const scriptAssembly = script
    .toASM(script.decompile(Buffer.from(redeemScript, 'hex')) || [])
    .split(' ');
  const cltv = scriptAssembly[10];
  const refundPubKey = scriptAssembly[13];
  const expectedScript = [
    'OP_SIZE',
    '20',
    'OP_EQUAL',
    'OP_IF',
    'OP_HASH160',
    crypto.hash160(preimage).toString('hex'),
    'OP_EQUALVERIFY',
    pubKey,
    'OP_ELSE',
    'OP_DROP',
    cltv,
    'OP_NOP2',
    'OP_DROP',
    refundPubKey,
    'OP_ENDIF',
    'OP_CHECKSIG',
  ];
  return scriptAssembly.join() === expectedScript.join();
};

export const isValidInvoice = (
  invoice: string,
  lockupAddress: string,
  preimage: Buffer,
  pubKey: string,
  redeemScript: string
): boolean => {
  return (
    correctPaymentHashInInvoice(invoice, preimage) &&
    reverseSwapAddressDerivesFromScript(lockupAddress, redeemScript) &&
    validReverseSwapReedemScript(preimage, pubKey, redeemScript)
  );
};

export const makeSubmarineSwap = async (
  invoice: string,
  network: NetworkString,
  walletRepository: WalletRepository
): Promise<any> => {
  // get refund public key
  const accountName = network === 'liquid' ? MainAccount : MainAccountTest;
  const accountFactory = await AccountFactory.create(walletRepository);
  const mainAccount = await accountFactory.make(network, accountName);
  const addr = await mainAccount.getNextAddress(false);
  const refundPublicKey = addr.publicKey;
  // make swap
  const boltz = new Boltz(network);
  const { address, expectedAmount, redeemScript } = await boltz.createSubmarineSwap({
    invoice,
    refundPublicKey,
  });

  // validate submarine swap
  if (!isValidSubmarineSwap(redeemScript, refundPublicKey))
    throw new Error('invalid submarine swap');

  return { address, expectedAmount };
};
