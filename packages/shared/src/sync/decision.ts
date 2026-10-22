const SYNC_ENTITY_TYPE_VALUES = [
  'user_profile',
  'gym',
  'equipment',
  'exercise',
  'workout_plan',
  'weekly_schedule',
  'workout_session',
  'performed_set',
  'exercise_feedback',
  'student_professional_link',
] as const;

export const SYNC_ENTITY_TYPES = SYNC_ENTITY_TYPE_VALUES;
export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

export const SYNC_OPERATION_TYPES = ['upsert', 'delete', 'correct'] as const;
export type SyncOperationType = (typeof SYNC_OPERATION_TYPES)[number];

export const SERVER_SYNC_STATUSES = ['pending', 'applied', 'rejected', 'conflict'] as const;
export type ServerSyncStatus = (typeof SERVER_SYNC_STATUSES)[number];

export const DEVICE_QUEUE_STATUSES = [
  'pending',
  'in_flight',
  'error',
  'done',
  'superseded',
] as const;
export type DeviceQueueStatus = (typeof DEVICE_QUEUE_STATUSES)[number];

export type SyncDomain =
  | 'reference_catalog'
  | 'editable_aggregate'
  | 'workout_session'
  | 'performed_set'
  | 'feedback'
  | 'professional_permission';

export type SyncRejectCode =
  | 'idempotency_key_reused'
  | 'server_authoritative'
  | 'session_locked'
  | 'corrections_apply_to_performed_sets'
  | 'performed_sets_are_immutable'
  | 'professional_grant_requires_server'
  | 'target_not_found';

export type SyncConflictCode = 'version_mismatch' | 'performed_set_diverged';

export type SyncDecision =
  | { outcome: 'apply' }
  | { outcome: 'acknowledge_duplicate' }
  | { outcome: 'reject'; code: SyncRejectCode }
  | {
      outcome: 'conflict';
      code: SyncConflictCode;
      resolution: 'user_required' | 'retain_server_and_preserve_client';
    };

export type SyncServerRecord = {
  version: number;
  payloadHash: string | null;
  locked: boolean;
  status?: string;
};

export type SyncDecisionInput = {
  domain: SyncDomain;
  operation: SyncOperationType;
  payloadHash: string;
  baseVersion: number | null;
  server: SyncServerRecord | null;
  existingOperation: { payloadHash: string } | null;
};

function versionsMatch(input: SyncDecisionInput): boolean {
  return (
    input.server !== null &&
    input.baseVersion !== null &&
    input.baseVersion === input.server.version
  );
}

function versionConflict(): SyncDecision {
  return { outcome: 'conflict', code: 'version_mismatch', resolution: 'user_required' };
}

function decideEditable(input: SyncDecisionInput): SyncDecision {
  if (input.server === null) {
    if (input.operation === 'delete') {
      return { outcome: 'acknowledge_duplicate' };
    }
    if (input.operation === 'correct') {
      return { outcome: 'reject', code: 'target_not_found' };
    }
    return { outcome: 'apply' };
  }

  if (!versionsMatch(input)) {
    return versionConflict();
  }

  return { outcome: 'apply' };
}

function decideSession(input: SyncDecisionInput): SyncDecision {
  if (input.operation === 'correct') {
    return { outcome: 'reject', code: 'corrections_apply_to_performed_sets' };
  }

  if (input.server === null) {
    if (input.operation === 'delete') {
      return { outcome: 'acknowledge_duplicate' };
    }
    return { outcome: 'apply' };
  }

  if (input.server.locked) {
    return { outcome: 'reject', code: 'session_locked' };
  }

  if (!versionsMatch(input)) {
    return versionConflict();
  }

  return { outcome: 'apply' };
}

function decidePerformedSet(input: SyncDecisionInput): SyncDecision {
  if (input.operation === 'delete') {
    return { outcome: 'reject', code: 'performed_sets_are_immutable' };
  }

  if (input.server === null) {
    if (input.operation === 'correct') {
      return { outcome: 'reject', code: 'target_not_found' };
    }
    return { outcome: 'apply' };
  }

  if (input.operation === 'correct') {
    return { outcome: 'apply' };
  }

  if (input.server.payloadHash === input.payloadHash) {
    return { outcome: 'acknowledge_duplicate' };
  }

  return {
    outcome: 'conflict',
    code: 'performed_set_diverged',
    resolution: 'retain_server_and_preserve_client',
  };
}

function decideProfessionalPermission(input: SyncDecisionInput): SyncDecision {
  if (input.operation !== 'delete') {
    return { outcome: 'reject', code: 'professional_grant_requires_server' };
  }

  if (input.server === null) {
    return { outcome: 'reject', code: 'target_not_found' };
  }

  if (input.server.locked || input.server.status === 'revoked') {
    return { outcome: 'acknowledge_duplicate' };
  }

  return { outcome: 'apply' };
}

export function evaluateSyncDecision(input: SyncDecisionInput): SyncDecision {
  if (input.existingOperation) {
    if (input.existingOperation.payloadHash === input.payloadHash) {
      return { outcome: 'acknowledge_duplicate' };
    }
    return { outcome: 'reject', code: 'idempotency_key_reused' };
  }

  switch (input.domain) {
    case 'reference_catalog':
      return { outcome: 'reject', code: 'server_authoritative' };
    case 'editable_aggregate':
    case 'feedback':
      return decideEditable(input);
    case 'workout_session':
      return decideSession(input);
    case 'performed_set':
      return decidePerformedSet(input);
    case 'professional_permission':
      return decideProfessionalPermission(input);
    default: {
      const unreachable: never = input.domain;
      return unreachable;
    }
  }
}

export function queueStatusAfterRestart(status: DeviceQueueStatus): DeviceQueueStatus {
  if (status === 'in_flight') {
    return 'pending';
  }
  return status;
}
