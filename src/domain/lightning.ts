import bolt11 from 'bolt11';
import { bech32 } from 'bech32';
import type { NetworkString } from 'marina-provider';

export const getInvoicePrefixForNetwork = (network: NetworkString): string =>
  network === 'liquid' ? 'lnbc' : 'lntb';

const parseLNURL = (lnurl: string): string => {
  if (lnurl.includes('@')) {
    // Lightning address
    const urlsplit = lnurl.split('@');
    return `https://${urlsplit[1]}/.well-known/lnurlp/${urlsplit[0]}`;
  }
  // LNURL
  const { words } = bech32.decode(lnurl, 2000);
  const requestByteArray = bech32.fromWords(words);
  return Buffer.from(requestByteArray).toString();
};

export const fetchInvoiceFromLNURL = async (lnurl: string, amount_sat = 0): Promise<string> => {
  const url = parseLNURL(lnurl);
  const amount = Math.round(amount_sat * 1000);
  // check if amount is allowed
  let resp = await fetch(url);
  let data = await resp.json();
  if (amount < data.minSendable || amount > data.maxSendable) {
    throw new Error('Amount not in LNURL range.');
  }
  // fetch payment request aka invoice
  resp = await fetch(`${data.callback}?amount=${amount}`);
  data = await resp.json();
  return data.pr;
};

export const isValidLNURL = async (lnurl: string): Promise<boolean> => {
  console.log('lnurl', lnurl);
  try {
    const url = parseLNURL(lnurl);
    const resp = await fetch(url);
    return resp.ok;
  } catch (ignore) {
    return false;
  }
};

export const isValidInvoice = (invoice: string): boolean => {
  console.log('isValidInvoice invoice', invoice);
  try {
    bolt11.decode(invoice);
    return true;
  } catch (ignore) {
    return false;
  }
};

export const isValidInvoiceForNetwork = (invoice: string, network: NetworkString): boolean => {
  console.log('isValidInvoice network', network);
  if (invoice.substring(0, 4) !== getInvoicePrefixForNetwork(network)) return false;
  return isValidInvoice(invoice);
};
