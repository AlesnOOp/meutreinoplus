import { describe, expect, it } from 'vitest';
import {
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS_PT,
  PERCEIVED_LEVELS,
  PERCEIVED_LEVEL_DISCLAIMER_PT,
  PERCEIVED_LEVEL_LABELS_PT,
  PROGRESSIVE_LOAD_NOTE_PT,
} from './catalog';

describe('catalog labels', () => {
  it('has a Portuguese label for every muscle group and perceived level', () => {
    for (const muscle of MUSCLE_GROUPS) {
      expect(MUSCLE_GROUP_LABELS_PT[muscle].length).toBeGreaterThan(0);
    }
    for (const level of PERCEIVED_LEVELS) {
      expect(PERCEIVED_LEVEL_LABELS_PT[level].length).toBeGreaterThan(0);
    }
  });

  it('does not turn subjective effort or progressive load into a prescription', () => {
    expect(PERCEIVED_LEVEL_DISCLAIMER_PT).toContain('Não diagnostica');
    expect(PROGRESSIVE_LOAD_NOTE_PT.toLowerCase()).toContain('não calcula');
  });
});
