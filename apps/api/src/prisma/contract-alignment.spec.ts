import {
  ACTIVITY_TYPES,
  CARDIO_ACTIVITIES,
  EQUIPMENT_TYPES,
  LOAD_TYPES,
  MUSCLE_GROUPS,
  SUBSCRIPTION_STATUSES,
  SYNC_ENTITY_TYPES,
  SYNC_OPERATION_TYPES,
} from '@meutreino/shared';
import {
  ActivityType,
  CardioActivity,
  EquipmentType,
  LoadType,
  MuscleGroup,
  SubscriptionStatus,
  SyncEntityType,
  SyncOperationType,
} from '../generated/prisma/client';

describe('Prisma and shared contracts', () => {
  it('keeps sync, billing, and catalog enums aligned', () => {
    expect(Object.values(SyncEntityType).sort()).toEqual([...SYNC_ENTITY_TYPES].sort());
    expect(Object.values(SyncOperationType).sort()).toEqual([...SYNC_OPERATION_TYPES].sort());
    expect(Object.values(SubscriptionStatus).sort()).toEqual([...SUBSCRIPTION_STATUSES].sort());
    expect(Object.values(MuscleGroup).sort()).toEqual([...MUSCLE_GROUPS].sort());
    expect(Object.values(ActivityType).sort()).toEqual([...ACTIVITY_TYPES].sort());
    expect(Object.values(EquipmentType).sort()).toEqual([...EQUIPMENT_TYPES].sort());
    expect(Object.values(CardioActivity).sort()).toEqual([...CARDIO_ACTIVITIES].sort());
    expect(Object.values(LoadType).sort()).toEqual([...LOAD_TYPES].sort());
  });
});
