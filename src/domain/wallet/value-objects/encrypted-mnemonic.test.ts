import { EncryptedMnemonic } from './encrypted-mnemonic';
import { encryptedMnemonic } from '../../../../test/fixtures/wallet.json';

test('Should be able to create an encrypted mnemonic', () => {
  const res = EncryptedMnemonic.create(encryptedMnemonic);
  expect(res.value).toContain(encryptedMnemonic);
  //
  expect(() => EncryptedMnemonic.create('invalidEncryptedMnemonic')).toThrow(
    'Encrypted mnemonic must be between 160 between and 192 chars'
  );
});