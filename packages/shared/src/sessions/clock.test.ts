import { describe, expect, it } from 'vitest';
import { activeSeconds, elapsedSeconds, restRemainingSeconds } from './clock';

const start = '2026-10-20T12:00:00.000Z';

describe('workout clocks', () => {
  it('keeps counting from timestamps after the app leaves memory', () => {
    expect(
      activeSeconds({
        startedAt: start,
        events: [],
        now: '2026-10-20T12:01:30.000Z',
      }),
    ).toBe(90);
  });

  it('excludes paused time and keeps the wall clock separate', () => {
    const events = [
      { kind: 'pause' as const, occurredAt: '2026-10-20T12:00:20.000Z' },
      { kind: 'resume' as const, occurredAt: '2026-10-20T12:00:50.000Z' },
    ];
    expect(activeSeconds({ startedAt: start, events, now: '2026-10-20T12:01:20.000Z' })).toBe(50);
    expect(elapsedSeconds({ startedAt: start, now: '2026-10-20T12:01:20.000Z' })).toBe(80);
  });

  it('does not shrink active time when the device clock jumps backward', () => {
    const events = [
      { kind: 'pause' as const, occurredAt: '2026-10-20T12:00:30.000Z' },
      { kind: 'resume' as const, occurredAt: '2026-10-20T12:00:10.000Z' },
    ];
    expect(activeSeconds({ startedAt: start, events, now: '2026-10-20T12:00:40.000Z' })).toBe(40);
  });

  it('resumes a rest countdown from the original timestamp', () => {
    expect(
      restRemainingSeconds({
        startedAt: start,
        durationSeconds: 90,
        pauses: [],
        now: '2026-10-20T12:01:00.000Z',
      }),
    ).toBe(30);
  });
});
