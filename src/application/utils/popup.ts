import browser from 'webextension-polyfill';

export async function setUpPopup(): Promise<void> {
  // set the popup after the onboarding flow
  await browser.action.setPopup({ popup: 'popup.html' }).catch(console.error);
}
