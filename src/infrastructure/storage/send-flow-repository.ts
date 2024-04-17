import Browser from 'webextension-polyfill';
import type { SendFlowRepository } from '../../domain/repository';
import { SendFlowStep } from '../../domain/repository';
import type { SubmarineSwapResponse } from '../../pkg/boltz';

export type SwapInfo = {
  invoice: string;
  refundPublicKey: string;
  swapResponse: SubmarineSwapResponse;
};

type Data = {
  amount?: number;
  asset?: string;
  pset?: string;
  receiverAddress?: string;
  swapInfo?: SwapInfo;
};

enum SendFlowStorageKeys {
  SEND_FLOW_DATA = 'sendFlowData',
}

export class SendFlowStorageAPI implements SendFlowRepository {
  private async getSendFlowData(): Promise<Data | undefined> {
    const data = await Browser.storage.local.get(SendFlowStorageKeys.SEND_FLOW_DATA);
    return data[SendFlowStorageKeys.SEND_FLOW_DATA];
  }

  private async updateSendFlowData(data: Partial<Data>): Promise<void> {
    const currentData = await this.getSendFlowData();
    return Browser.storage.local.set({
      [SendFlowStorageKeys.SEND_FLOW_DATA]: {
        ...currentData,
        ...data,
      },
    });
  }

  async getStep(): Promise<SendFlowStep> {
    const data = await this.getSendFlowData();
    if (!data) return SendFlowStep.None;
    if (data.pset) return SendFlowStep.FeeFormDone;
    if (data.receiverAddress && data.amount) return SendFlowStep.AddressAmountFormDone;
    if (data.asset && !data.swapInfo) return SendFlowStep.AssetSelected;
    if (data.asset && data.swapInfo) return SendFlowStep.Lightning;
    return SendFlowStep.None;
  }

  reset(): Promise<void> {
    return Browser.storage.local.remove(SendFlowStorageKeys.SEND_FLOW_DATA);
  }

  async getSelectedAsset(): Promise<string | undefined> {
    const data = await this.getSendFlowData();
    if (!data) return undefined;
    return data.asset;
  }

  async getReceiverAddress(): Promise<string | undefined> {
    const data = await this.getSendFlowData();
    if (!data) return undefined;
    return data.receiverAddress;
  }

  async getAmount(): Promise<number | undefined> {
    const data = await this.getSendFlowData();
    if (!data) return undefined;
    return data.amount;
  }

  async getPset(): Promise<string | undefined> {
    const data = await this.getSendFlowData();
    if (!data) return undefined;
    return data.pset;
  }

  async getUnsignedPset(): Promise<string | undefined> {
    const data = await this.getSendFlowData();
    if (!data) return undefined;
    return data.pset;
  }

  async getSwapInfo(): Promise<SwapInfo | undefined> {
    const data = await this.getSendFlowData();
    return data?.swapInfo;
  }

  setSelectedAsset(asset: string): Promise<void> {
    return this.updateSendFlowData({ asset });
  }

  setReceiverAddressAmount(address: string, amount: number): Promise<void> {
    return this.updateSendFlowData({ receiverAddress: address, amount });
  }

  setUnsignedPset(pset: string): Promise<void> {
    return this.updateSendFlowData({ pset });
  }

  setSwapInfo(swapInfo: SwapInfo): Promise<void> {
    return this.updateSendFlowData({ swapInfo });
  }
}
