import type { NetworkString } from 'marina-provider';

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
