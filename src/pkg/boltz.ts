// docs: https://docs.boltz.exchange/en/latest/api/

import { randomBytes } from 'crypto';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import type { OwnedInput } from 'liquidjs-lib';
import {
  address,
  AssetHash,
  Blinder,
  Creator,
  crypto,
  Extractor,
  Finalizer,
  Pset,
  script as bscript,
  script,
  Signer,
  Transaction,
  Updater,
  witnessStackToScriptWitness,
  ZKPGenerator,
  ZKPValidator,
  networks,
} from 'liquidjs-lib';
import bolt11 from 'bolt11';
import type { Unspent } from '../domain/chainsource';
import type { ECPairInterface } from 'ecpair';
import type { Secp256k1ZKP } from '@vulpemventures/secp256k1-zkp';
import { fromSatoshi } from '../extension/utility';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import axios, { AxiosError } from 'axios';
import { extractErrorMessage } from '../extension/utility/error';
import Decimal from 'decimal.js';
import type { RefundableSwapParams } from '../domain/repository';
import type { NetworkString } from 'marina-provider';
import { swapEndian } from '../application/utils';
import { addressFromScript } from '../extension/utility/address';
import { Musig, OutputType, SwapTreeSerializer, detectSwap, targetFee } from 'boltz-core';
import type { Network } from 'liquidjs-lib/src/networks';
import { TaprootUtils, constructClaimTransaction } from 'boltz-core/dist/lib/liquid';
import zkp from '@vulpemventures/secp256k1-zkp';
import type { SwapInfo } from '../infrastructure/storage/send-flow-repository';

const zkLib = await zkp();

export interface SubmarineSwapResponse {
  id: string;
  bip21: string;
  address: string;
  swapTree: {
    claimLeaf: {
      version: number;
      output: string;
    };
    refundLeaf: {
      version: number;
      output: string;
    };
  };
  blindingKey: string;
  acceptZeroConf: boolean;
  expectedAmount: number;
  claimPublicKey: string;
  timeoutBlockHeight: number;
}

export interface ReverseSwapResponse {
  id: string;
  invoice: string;
  swapTree: {
    claimLeaf: {
      version: number;
      output: string;
    };
    refundLeaf: {
      version: number;
      output: string;
    };
  };
  blindingKey: string;
  lockupAddress: string;
  onchainAmount: number;
  refundPublicKey: string;
  timeoutBlockHeight: number;
}

export interface SubmarineSwap {
  address: string;
  blindingKey: string;
  expectedAmount: number;
  id: string;
  redeemScript: string;
  refundPublicKey: string;
}

export interface ReverseSwap {
  blindingPrivateKey: string;
  claimPublicKey: string;
  id: string;
  invoice: string;
  lockupAddress: string;
  preimage: Buffer;
  redeemScript: string;
  timeoutBlockHeight: number;
}

export interface MakeClaimTransactionParams {
  utxo: Unspent;
  claimKeyPair: ECPairInterface;
  preimage: Buffer;
  redeemScript: Buffer;
  destinationScript: Buffer;
  blindingPublicKey: Buffer;
  satsPerByte?: number;
}

export interface MakeRefundTransactionParams {
  utxo: Unspent;
  refundKeyPair: ECPairInterface;
  redeemScript: Buffer;
  timeoutBlockHeight?: number;
  destinationScript: Buffer;
  blindingPublicKey: Buffer;
  satsPerByte?: number;
}

export type GetClaimTransactionParams = MakeClaimTransactionParams & {
  fee: number;
};

export type GetRefundTransactionParams = MakeRefundTransactionParams & {
  fee: number;
};

export type MagicHint = {
  cltv_expiry_delta: number;
  fee_base_msat: number;
  fee_proportional_millionths: number;
  pubkey: string;
  short_channel_id: string;
};

type DecodedInvoice = {
  expire_time?: number;
  invoice: string;
  paymentHash: string;
  note?: string;
  magicHint?: MagicHint;
  satoshis: number;
  timeExpireDate?: number;
  timestamp: number;
};

export interface BoltzPair {
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
}

const boltzApiUrl: Record<NetworkString, string> = {
  regtest: 'http://localhost:9090',
  testnet: 'https://api.testnet.boltz.exchange',
  liquid: 'https://api.boltz.exchange',
};

const boltzWsUrl = (network: NetworkString): string =>
  `${boltzApiUrl[network].replace('https://', 'wss://')}/v2/ws`;

export interface BoltzInterface {
  getBoltzPair(pair: string): Promise<any>;
  submarineSwap(invoice: string, refundPublicKey: string): Promise<SubmarineSwapResponse>;
  reverseSwap(
    invoiceAmount: number,
    destinationAddress: string,
    onFinish: (txid: string) => void,
    onInvoice: (invoice: string) => void
  ): Promise<void>;
  getInvoiceExpireDate(invoice: string): number;
  getInvoiceValue(invoice: string): number;
  getLiquidAddress(invoice: string, magicHint: MagicHint): Promise<string>;
  getMagicHint(invoice: string): MagicHint | undefined;
}
export class Boltz implements BoltzInterface {
  private apiUrl: string;
  private asset: string;
  private network: Network;
  private wsUrl: string;
  private zkp: Secp256k1ZKP;

  constructor(networkName: NetworkString) {
    this.asset = networks[networkName].assetHash;
    this.apiUrl = boltzApiUrl[networkName];
    this.network = networks[networkName];
    this.wsUrl = boltzWsUrl(networkName);
    this.zkp = zkLib;
  }

  async getBoltzPair(pair: string): Promise<BoltzPair | undefined> {
    const data = await this.getApi(`${this.apiUrl}/getpairs`);
    if (!data?.pairs?.[pair]) return;
    return data.pairs[pair];
  }

  calcBoltzFees(pair: BoltzPair, amountInSats: number) {
    const minersFees = pair.fees.minerFees.baseAsset.normal;
    const percentage = pair.fees.percentageSwapIn;
    return Decimal.ceil(
      new Decimal(amountInSats).mul(percentage).div(100).add(minersFees)
    ).toNumber();
  }

  findTag = (decoded: any, tag: string) => {
    if (decoded[tag]) return decoded[tag];
    return decoded.tags.find((a: any) => a.tagName === tag)?.data;
  };

  decodeInvoice = (invoice: string): DecodedInvoice => {
    const decoded = bolt11.decode(invoice);
    console.log('decoded', decoded);
    let satoshis = this.findTag(decoded, 'satoshis');
    if (!satoshis) satoshis = Math.floor(Number(this.findTag(decoded, 'milisatoshis') ?? 0) / 1000);
    const routeInfo = this.findTag(decoded, 'routing_info') ?? [];
    console.log('routeinfo', routeInfo);
    const response = {
      expire_time: this.findTag(decoded, 'expire_time'),
      invoice,
      paymentHash: this.findTag(decoded, 'payment_hash'),
      note: this.findTag(decoded, 'description'),
      magicHint: routeInfo?.find((x: any) => x.short_channel_id === '0846c900051c0000'),
      satoshis,
      timeExpireDate: this.findTag(decoded, 'timeExpireDate'),
      timestamp: this.findTag(decoded, 'timestamp'),
    };
    console.log('response', response);
    return response;
  };

  // return invoice expire date
  getInvoiceExpireDate(invoice: string): number {
    const toMilliseconds = (num: number) => num * 1000;
    const { expire_time, timeExpireDate, timestamp } = this.decodeInvoice(invoice);
    if (!timestamp) throw new Error('Invoice without timestamp');
    if (timeExpireDate) return toMilliseconds(timeExpireDate);
    return timestamp + toMilliseconds(expire_time ?? 3600);
  }

  // return value in given invoice
  getInvoiceValue(invoice: string): number {
    const { satoshis } = this.decodeInvoice(invoice);
    if (!satoshis) throw new Error('Invoice without amount');
    return fromSatoshi(satoshis, 8);
  }

  // return value in given invoice
  getMagicHint(invoice: string): MagicHint | undefined {
    return this.decodeInvoice(invoice).magicHint;
  }

  async getLiquidAddress(invoice: string, magicHint: MagicHint): Promise<string> {
    const bip21Data = (await axios.get(`${this.apiUrl}/v2/swap/reverse/${invoice}/bip21`)).data;
    const bip21Split = bip21Data.bip21.split(':');
    const bip21Address = bip21Split[1].split('?')[0];

    if (
      !ECPairFactory(ecc)
        .fromPublicKey(Buffer.from(magicHint.pubkey, 'hex'))
        .verifySchnorr(
          crypto.sha256(Buffer.from(bip21Address, 'utf-8')),
          Buffer.from(bip21Data.signature, 'hex')
        )
    ) {
      throw new Error('BOLTZ IS TRYING TO CHEAT');
    }

    return bip21Address;
  }

  makeRefundTransaction(params: MakeRefundTransactionParams): Transaction {
    // In order to calculate fees for tx:
    // 1. make tx with dummy fee
    const getParams: GetRefundTransactionParams = { ...params, fee: 300 };
    const tx = this.getRefundTransaction(getParams);
    // 2. calculate fees for this tx
    const satsPerByte = params.satsPerByte ?? 0.1;
    getParams.fee = Math.ceil((tx.virtualSize() + tx.ins.length) * satsPerByte);
    // 3 return tx with updated fees
    return this.getRefundTransaction(getParams);
  }

  getRefundTransaction({
    utxo,
    refundKeyPair,
    redeemScript,
    destinationScript,
    timeoutBlockHeight,
    fee,
    blindingPublicKey,
  }: GetRefundTransactionParams): Transaction {
    if (!utxo.blindingData) throw new Error('utxo is not blinded');
    if (!utxo.witnessUtxo) throw new Error('utxo missing witnessUtxo');
    const pset = Creator.newPset();
    const updater = new Updater(pset);

    updater
      .addInputs([
        {
          txid: utxo.txid,
          txIndex: utxo.vout,
          witnessUtxo: utxo.witnessUtxo,
          sighashType: Transaction.SIGHASH_ALL,
          heightLocktime: timeoutBlockHeight,
          sequence: 21,
        },
      ])
      .addInWitnessScript(0, redeemScript)
      .addOutputs([
        {
          script: destinationScript,
          blindingPublicKey,
          asset: this.asset,
          amount: (utxo.blindingData?.value ?? 0) - fee,
          blinderIndex: 0,
        },
        {
          amount: fee,
          asset: this.asset,
        },
      ]);

    const blindedPset = this.blindPset(pset, {
      index: 0,
      value: utxo.blindingData.value.toString(),
      valueBlindingFactor: Buffer.from(utxo.blindingData.valueBlindingFactor, 'hex'),
      asset: AssetHash.fromHex(utxo.blindingData.asset).bytesWithoutPrefix,
      assetBlindingFactor: Buffer.from(utxo.blindingData.assetBlindingFactor, 'hex'),
    });

    const signedPset = this.signPset(blindedPset, refundKeyPair);

    const finalizer = new Finalizer(signedPset);

    finalizer.finalizeInput(0, (inputIndex, pset) => {
      return {
        finalScriptSig: undefined,
        finalScriptWitness: witnessStackToScriptWitness([
          pset.inputs[inputIndex].partialSigs![0].signature,
          Buffer.of(), //dummy preimage
          redeemScript,
        ]),
      };
    });

    return Extractor.extract(finalizer.pset);
  }

  extractInfoFromRefundableSwapParams(params: RefundableSwapParams) {
    const { blindingKey, redeemScript } = params;
    const network = params.network ?? 'liquid';

    const fundingAddress = addressFromScript(redeemScript, network);

    const scriptAssembly = script
      .toASM(script.decompile(Buffer.from(redeemScript, 'hex')) || [])
      .split(' ');

    const timeoutBlockHeight = parseInt(swapEndian(scriptAssembly[6]), 16);

    return {
      blindingKey,
      fundingAddress,
      redeemScript,
      refundPublicKey: scriptAssembly[9],
      timeoutBlockHeight,
    };
  }

  async submarineSwap(invoice: string, refundPublicKey: string): Promise<SubmarineSwapResponse> {
    console.log('called submarine swap');
    return new Promise((resolve, reject) => {
      void axios
        .post(`${this.apiUrl}/v2/swap/submarine`, {
          invoice,
          to: 'BTC',
          from: 'L-BTC',
          refundPublicKey,
        })
        .then((res) => {
          const swapResponse = res.data as SubmarineSwapResponse;
          if (!this.isValidSubmarineSwapResponse(swapResponse))
            throw new Error('Invalid submarine swap');

          console.log('Created swap');
          console.log(swapResponse);

          const webSocket = new WebSocket(this.wsUrl);
          webSocket.onopen = () => {
            webSocket.send(
              JSON.stringify({
                op: 'subscribe',
                channel: 'swap.update',
                args: [swapResponse.id],
              })
            );
          };

          webSocket.onmessage = (rawMsg) => {
            let msg;

            try {
              msg = JSON.parse(rawMsg.data);
            } catch (_) {
              return;
            }

            if (msg.event !== 'update') {
              return;
            }

            console.log('Got WebSocket update');
            console.log(msg);
            console.log();

            switch (msg.args[0].status) {
              // "invoice.set" means Boltz is waiting for an onchain transaction to be sent
              case 'invoice.set': {
                console.log('Waiting for onchain transaction');
                resolve(swapResponse);
                break;
              }
            }
          };
        });
    });
  }

  finalizeSubmarineSwap = (swapInfo: SwapInfo) => {
    return new Promise((resolve, reject) => {
      const { invoice, swapResponse } = swapInfo;
      if (!invoice || !swapResponse) return reject();
      const keys = ECPairFactory(ecc).makeRandom();

      // Create a WebSocket and subscribe to updates for the created swap
      const webSocket = new WebSocket(this.wsUrl);
      webSocket.onopen = () => {
        webSocket.send(
          JSON.stringify({
            op: 'subscribe',
            channel: 'swap.update',
            args: [swapResponse.id],
          })
        );
      };

      webSocket.onmessage = async (rawMsg) => {
        let msg;

        try {
          msg = JSON.parse(rawMsg.data);
        } catch (_) {
          return;
        }

        if (msg.event !== 'update') {
          return;
        }

        console.log('Got WebSocket update');
        console.log(msg);
        console.log();

        switch (msg.args[0].status) {
          // Create a partial signature to allow Boltz to do a key path spend to claim the mainchain coins
          case 'transaction.claim.pending': {
            console.log('Creating cooperative claim transaction');

            // Get the information request to create a partial signature
            const claimTxDetails = (
              await axios.get(`${this.apiUrl}/v2/swap/submarine/${swapResponse.id}/claim`)
            ).data;

            // Verify that Boltz actually paid the invoice by comparing the preimage hash
            // of the invoice to the SHA256 hash of the preimage from the response
            const invoicePreimageHash = Buffer.from(
              bolt11.decode(invoice).tags.find((tag) => tag.tagName === 'payment_hash')!
                .data as string,
              'hex'
            );
            if (
              !crypto
                .sha256(Buffer.from(claimTxDetails.preimage, 'hex'))
                .equals(invoicePreimageHash)
            ) {
              console.error('Boltz provided invalid preimage');
              return reject('Boltz provided invalid preimage');
            }

            const boltzPublicKey = Buffer.from(swapResponse.claimPublicKey, 'hex');

            // Create a musig signing instance
            const musig = new Musig(zkLib, keys, randomBytes(32), [boltzPublicKey, keys.publicKey]);
            // Tweak that musig with the Taptree of the swap scripts
            TaprootUtils.tweakMusig(
              musig,
              SwapTreeSerializer.deserializeSwapTree(swapResponse.swapTree).tree
            );

            // Aggregate the nonces
            musig.aggregateNonces([[boltzPublicKey, Buffer.from(claimTxDetails.pubNonce, 'hex')]]);
            // Initialize the session to sign the transaction hash from the response
            musig.initializeSession(Buffer.from(claimTxDetails.transactionHash, 'hex'));

            // Give our public nonce and the partial signature to Boltz
            await axios.post(`${this.apiUrl}/v2/swap/submarine/${swapResponse.id}/claim`, {
              pubNonce: Buffer.from(musig.getPublicNonce()).toString('hex'),
              partialSignature: Buffer.from(musig.signPartial()).toString('hex'),
            });

            break;
          }

          case 'transaction.claimed':
            console.log('Swap successful');
            console.log('msg', msg);
            webSocket.close();
            resolve('');
            break;
        }
      };
    });
  };

  async reverseSwap(
    invoiceAmount: number,
    destinationAddress: string,
    onFinish: (txid: string) => void,
    onInvoice: (invoice: string) => void
  ): Promise<void> {
    // Create a random preimage for the swap; has to have a length of 32 bytes
    const preimage = randomBytes(32);
    const keys = ECPairFactory(this.zkp.ecc).makeRandom();
    const signature = keys.signSchnorr(crypto.sha256(Buffer.from(destinationAddress, 'utf-8')));

    let claimTx: Transaction;

    // Create a Submarine Swap
    const createdResponse = (
      await axios.post(`${this.apiUrl}/v2/swap/reverse`, {
        address: destinationAddress,
        addressSignature: signature.toString('hex'),
        claimPublicKey: keys.publicKey.toString('hex'),
        from: 'BTC',
        invoiceAmount,
        preimageHash: crypto.sha256(preimage).toString('hex'),
        to: 'L-BTC',
      })
    ).data as ReverseSwapResponse;

    onInvoice(createdResponse.invoice);
    console.log('Created swap');
    console.log(createdResponse);
    console.log();

    // Create a WebSocket and subscribe to updates for the created swap
    const webSocket = new WebSocket(this.wsUrl);
    webSocket.onopen = () => {
      webSocket.send(
        JSON.stringify({
          op: 'subscribe',
          channel: 'swap.update',
          args: [createdResponse.id],
        })
      );
    };

    webSocket.onmessage = async (rawMsg) => {
      const msg = JSON.parse(rawMsg.data);
      if (msg.event !== 'update') {
        return;
      }

      console.log();
      console.log('-----');
      console.log('Got WebSocket update');
      console.log(JSON.stringify(msg.args[0], undefined, 2));
      console.log('-----');
      console.log();

      switch (msg.args[0].status) {
        // "swap.created" means Boltz is waiting for the invoice to be paid
        case 'swap.created': {
          console.log('Waiting invoice to be paid');
          break;
        }

        // "transaction.mempool" means that Boltz send an onchain transaction
        case 'transaction.mempool': {
          const boltzPublicKey = Buffer.from(createdResponse.refundPublicKey, 'hex');

          // Create a musig signing session and tweak it with the Taptree of the swap scripts
          const musig = new Musig(zkLib, keys, randomBytes(32), [boltzPublicKey, keys.publicKey]);
          const tweakedKey = TaprootUtils.tweakMusig(
            musig,
            SwapTreeSerializer.deserializeSwapTree(createdResponse.swapTree).tree
          );

          // Parse the lockup transaction and find the output relevant for the swap
          const lockupTx = Transaction.fromHex(msg.args[0].transaction.hex);
          console.log(`Got lockup transaction: ${lockupTx.getId()}`);

          const swapOutput = detectSwap(tweakedKey, lockupTx);
          if (swapOutput === undefined) {
            console.error('No swap output found in lockup transaction');
            return;
          }

          console.log('Creating claim transaction');

          // Create a claim transaction to be signed cooperatively via a key path spend
          const satsVbyte = 0.11;
          claimTx = targetFee(satsVbyte, (fee) =>
            constructClaimTransaction(
              [
                {
                  ...swapOutput,
                  keys,
                  preimage,
                  cooperative: true,
                  type: OutputType.Taproot,
                  txHash: lockupTx.getHash(),
                  blindingPrivateKey: Buffer.from(createdResponse.blindingKey, 'hex'),
                },
              ],
              address.toOutputScript(destinationAddress, this.network),
              fee,
              true,
              this.network,
              address.fromConfidential(destinationAddress).blindingKey
            )
          );

          // Get the partial signature from Boltz
          const boltzSig = (
            await axios.post(`${this.apiUrl}/v2/swap/reverse/${createdResponse.id}/claim`, {
              index: 0,
              transaction: claimTx.toHex(),
              preimage: preimage.toString('hex'),
              pubNonce: Buffer.from(musig.getPublicNonce()).toString('hex'),
            })
          ).data;

          // Aggregate the nonces
          musig.aggregateNonces([[boltzPublicKey, Buffer.from(boltzSig.pubNonce, 'hex')]]);

          // Initialize the session to sign the claim transaction
          musig.initializeSession(
            claimTx.hashForWitnessV1(
              0,
              [swapOutput.script],
              [{ asset: swapOutput.asset, value: swapOutput.value }],
              Transaction.SIGHASH_DEFAULT,
              this.network.genesisBlockHash
            )
          );

          // Add the partial signature from Boltz
          musig.addPartial(boltzPublicKey, Buffer.from(boltzSig.partialSignature, 'hex'));

          // Create our partial signature
          musig.signPartial();

          // Witness of the input to the aggregated signature
          claimTx.ins[0].witness = [musig.aggregatePartials()];

          // Broadcast the finalized transaction
          await axios.post(`${this.apiUrl}/v2/chain/L-BTC/transaction`, {
            hex: claimTx.toHex(),
          });

          break;
        }

        case 'invoice.settled': {
          console.log();
          console.log('Swap successful!');
          onFinish(claimTx.toHex());
          webSocket.close();
          break;
        }
      }
    };
  }

  // check that everything is correct with data received from Boltz:
  // - address
  // - redeemScript
  // - refundPublicKey
  private isValidSubmarineSwapResponse(response: SubmarineSwapResponse): boolean {
    return true;
  }

  private blindPset(pset: Pset, ownedInput: OwnedInput): Pset {
    const { ecc } = this.zkp;
    const zkpValidator = new ZKPValidator(this.zkp as any);
    const zkpGenerator = new ZKPGenerator(
      this.zkp as any,
      ZKPGenerator.WithOwnedInputs([ownedInput])
    );
    const outputBlindingArgs = zkpGenerator.blindOutputs(pset, Pset.ECCKeysGenerator(ecc));
    const blinder = new Blinder(pset, [ownedInput], zkpValidator, zkpGenerator);
    blinder.blindLast({ outputBlindingArgs });
    return blinder.pset;
  }

  private signPset(pset: Pset, claimKeyPair: ECPairInterface): Pset {
    const { ecc } = this.zkp;
    const signer = new Signer(pset);
    const toSign = signer.pset.getInputPreimage(0, Transaction.SIGHASH_ALL);
    signer.addSignature(
      0,
      {
        partialSig: {
          pubkey: claimKeyPair.publicKey,
          signature: bscript.signature.encode(claimKeyPair.sign(toSign), Transaction.SIGHASH_ALL),
        },
      },
      Pset.ECDSASigValidator(ecc)
    );
    return signer.pset;
  }

  private getApi = async (url: string): Promise<any> => {
    try {
      const config = { headers: { 'Content-Type': 'application/json' } };
      const { status, data } = await axios.get(url, config);
      if (status !== 200) throw new Error(data);
      return data;
    } catch (error: unknown | AxiosError) {
      const errorExtracted = extractErrorMessage(error);
      throw new Error(errorExtracted);
    }
  };

  private postApi = async (url: string, params: any = {}): Promise<any> => {
    try {
      const config = { headers: { 'Content-Type': 'application/json' } };
      const { status, data } = await axios.post(url, params, config);
      if (status !== 201) throw new Error(data);
      return data;
    } catch (error: unknown | AxiosError) {
      const errorExtracted = extractErrorMessage(error);
      throw new Error(errorExtracted);
    }
  };
}
