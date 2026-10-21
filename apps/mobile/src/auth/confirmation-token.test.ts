import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmationToken } from './confirmation-token.ts';

test('accepts a pasted code with whitespace', () => {
  assert.equal(confirmationToken('  saved-code\n'), 'saved-code');
});
test('extracts the code from the confirmation email link', () => {
  assert.equal(confirmationToken('meutreino://verify-email?token=email-code'), 'email-code');
});
test('accepts a recovery link with other parameters', () => {
  assert.equal(
    confirmationToken(
      'https://example.test/reset-password?source=email&token=code%2Bvalue&next=home#done',
    ),
    'code+value',
  );
});
test('rejects malformed encoding rather than sending a different code', () => {
  assert.throws(() => confirmationToken('meutreino://verify-email?token=%ZZ'), URIError);
});
