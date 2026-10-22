import { describe, it, expect } from 'vitest';
import { canonicalPlanContent } from './canonical';
const plan = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'A',
  description: null,
  accent: null,
  status: 'active',
  exercises: [
    {
      id: '10000000-0000-4000-8000-000000000002',
      exerciseId: '10000000-0000-4000-8000-000000000003',
      exerciseName: 'Display',
      orderIndex: 1,
      restSeconds: 90,
      notes: null,
      equipment: [],
      sets: [
        {
          id: '10000000-0000-4000-8000-000000000004',
          setIndex: 1,
          kind: 'normal',
          repetitions: 8,
          load: '20',
          loadUnit: 'kg',
          loadType: 'fixed',
          durationSeconds: null,
          restSeconds: 90,
          notes: null,
        },
      ],
    },
  ],
};
describe('official plan semantics', () => {
  it('normalizes load serialization and excludes timestamps and display labels', () => {
    const other = structuredClone(plan);
    other.exercises[0]!.exerciseName = 'Other display';
    other.exercises[0]!.sets[0]!.load = '20.00';
    expect(canonicalPlanContent({ ...other, createdAt: '2020-01-01T00:00:00.000Z' })).toBe(
      canonicalPlanContent(plan),
    );
  });
  it.each(['repetitions', 'restSeconds', 'setIndex'] as const)(
    'keeps %s prescribed values significant',
    (field) => {
      const other = structuredClone(plan);
      other.exercises[0]!.sets[0]![field] = 2;
      expect(canonicalPlanContent(other)).not.toBe(canonicalPlanContent(plan));
    },
  );
  it('does not equate an omitted set to the original prescription', () => {
    const other = structuredClone(plan);
    other.exercises[0]!.sets = [];
    expect(canonicalPlanContent(other)).not.toBe(canonicalPlanContent(plan));
  });
  it('does not equate a duplicate set to the original prescription', () => {
    const other = structuredClone(plan);
    other.exercises[0]!.sets.push({ ...other.exercises[0]!.sets[0]! });
    expect(canonicalPlanContent(other)).not.toBe(canonicalPlanContent(plan));
  });
  it('ignores JSON key order while preserving official plan name and status', () => {
    expect(canonicalPlanContent({ ...plan, name: 'Other' })).not.toBe(canonicalPlanContent(plan));
    expect(canonicalPlanContent({ ...plan, status: 'archived' })).not.toBe(
      canonicalPlanContent(plan),
    );
    expect(canonicalPlanContent({ ...plan, accent: undefined })).toBe(canonicalPlanContent(plan));
  });
});
