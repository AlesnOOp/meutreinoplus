import assert from 'node:assert/strict';
import test from 'node:test';
import { retainedLocalIds, syncBaseVersion } from './merge.ts';

test('snapshot merge keeps unsynced rows and drops remote deletions', () => {
  const kept = retainedLocalIds(
    [
      { id: 'pending-local', pending: true },
      { id: 'still-remote', pending: false },
      { id: 'removed-remote', pending: false },
    ],
    ['still-remote', 'new-remote'],
  );
  assert.deepEqual(kept, ['pending-local', 'still-remote']);
});

test('a row that has never reached the server has no base version', () => {
  assert.equal(syncBaseVersion(null), null);
  assert.equal(syncBaseVersion(3), 3);
});
