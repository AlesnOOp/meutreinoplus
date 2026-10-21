import { describe, expect, it } from 'vitest';
import { evaluateSyncDecision, queueStatusAfterRestart, type SyncDecisionInput } from './decision';

function input(overrides: Partial<SyncDecisionInput>): SyncDecisionInput {
  return {
    domain: 'editable_aggregate',
    operation: 'upsert',
    payloadHash: 'hash-a',
    baseVersion: 1,
    server: { version: 1, payloadHash: 'hash-a', locked: false },
    existingOperation: null,
    ...overrides,
  };
}

describe('evaluateSyncDecision', () => {
  it('acknowledges a retry with the same idempotent payload', () => {
    expect(
      evaluateSyncDecision(
        input({ existingOperation: { payloadHash: 'hash-a' }, domain: 'performed_set' }),
      ),
    ).toEqual({ outcome: 'acknowledge_duplicate' });
  });

  it('rejects reuse of an idempotency key with a different payload', () => {
    expect(evaluateSyncDecision(input({ existingOperation: { payloadHash: 'hash-b' } }))).toEqual({
      outcome: 'reject',
      code: 'idempotency_key_reused',
    });
  });

  it('keeps the system catalog server-authoritative', () => {
    expect(evaluateSyncDecision(input({ domain: 'reference_catalog', server: null }))).toEqual({
      outcome: 'reject',
      code: 'server_authoritative',
    });
  });

  it('applies an editable change only when the base version matches', () => {
    expect(evaluateSyncDecision(input({ server: null, baseVersion: null }))).toEqual({
      outcome: 'apply',
    });
    expect(evaluateSyncDecision(input({ baseVersion: 2 }))).toEqual({
      outcome: 'conflict',
      code: 'version_mismatch',
      resolution: 'user_required',
    });
  });

  it('does not let a stale write overwrite a locked workout session', () => {
    expect(
      evaluateSyncDecision(
        input({
          domain: 'workout_session',
          server: { version: 1, payloadHash: 'old', locked: true },
          payloadHash: 'new',
        }),
      ),
    ).toEqual({ outcome: 'reject', code: 'session_locked' });
  });

  it('refuses to overwrite a performed set when the payloads differ', () => {
    expect(
      evaluateSyncDecision(
        input({
          domain: 'performed_set',
          payloadHash: 'client',
          server: { version: 1, payloadHash: 'server', locked: true },
        }),
      ),
    ).toEqual({
      outcome: 'conflict',
      code: 'performed_set_diverged',
      resolution: 'retain_server_and_preserve_client',
    });
  });

  it('applies a performed-set correction without replacing the original row', () => {
    expect(
      evaluateSyncDecision(
        input({
          domain: 'performed_set',
          operation: 'correct',
          server: { version: 1, payloadHash: 'server', locked: true },
        }),
      ),
    ).toEqual({ outcome: 'apply' });
  });

  it('rejects deletion of a performed set', () => {
    expect(
      evaluateSyncDecision(input({ domain: 'performed_set', operation: 'delete', server: null })),
    ).toEqual({ outcome: 'reject', code: 'performed_sets_are_immutable' });
  });

  it('lets the student revoke professional access and ignores a repeated revoke', () => {
    expect(
      evaluateSyncDecision(
        input({
          domain: 'professional_permission',
          operation: 'delete',
          server: { version: 3, payloadHash: null, locked: false, status: 'active' },
        }),
      ),
    ).toEqual({ outcome: 'apply' });

    expect(
      evaluateSyncDecision(
        input({
          domain: 'professional_permission',
          operation: 'delete',
          server: { version: 4, payloadHash: null, locked: true, status: 'revoked' },
        }),
      ),
    ).toEqual({ outcome: 'acknowledge_duplicate' });
  });

  it('rejects a client grant of professional permission', () => {
    expect(
      evaluateSyncDecision(
        input({ domain: 'professional_permission', operation: 'upsert', server: null }),
      ),
    ).toEqual({ outcome: 'reject', code: 'professional_grant_requires_server' });
  });
});

describe('queueStatusAfterRestart', () => {
  it('returns an interrupted attempt to the pending queue', () => {
    expect(queueStatusAfterRestart('in_flight')).toBe('pending');
    expect(queueStatusAfterRestart('error')).toBe('error');
    expect(queueStatusAfterRestart('done')).toBe('done');
  });
});
