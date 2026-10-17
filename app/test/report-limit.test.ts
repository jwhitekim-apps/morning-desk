import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildReport, packSections } from '../src/briefing/report.js';

// Kakao 모듈과 같은 셈법(코드 포인트). 모듈을 import하지 않고 한 줄을 복제한다.
const count = (text: string): number => Array.from(text).length;

const piece = fc.oneof(
  fc.string({ unit: 'grapheme-ascii', maxLength: 60 }),
  fc.constantFrom('가', '나', '메일', ' ', '제목입니다 ').chain((s) => fc.integer({ min: 0, max: 40 }).map((n) => s.repeat(n))),
  fc.constantFrom('😀', '𠀋', '🎉').chain((s) => fc.integer({ min: 0, max: 120 }).map((n) => s.repeat(n))),
  fc.integer({ min: 1, max: 300 }).map((n) => 'x'.repeat(n)),
  fc.integer({ min: 1, max: 15 }).chain((n) => fc.constant('9'.repeat(n))),
);
const line = piece.map((s) => s.replace(/\n/g, ' '));
const section = fc.record({ title: fc.oneof(fc.constant(''), line), items: fc.array(line, { minLength: 1, maxLength: 40 }) });

const params = fc.record({
  header: line,
  sections: fc.array(section, { maxLength: 30 }),
  limit: fc.constantFrom(200, 200, 120, 60),
  maxMessages: fc.integer({ min: 1, max: 12 }),
});

describe('말풍선 글자 수 한도', () => {
  it('packSections: 쪽 표시를 포함한 모든 말풍선이 한도 이하이고 통 수를 넘지 않는다', () => {
    fc.assert(
      fc.property(params, ({ header, sections, limit, maxMessages }) => {
        const out = packSections(header, sections, limit, maxMessages);
        expect(out.length).toBeGreaterThanOrEqual(1);
        expect(out.length).toBeLessThanOrEqual(maxMessages);
        for (const b of out) expect(count(b)).toBeLessThanOrEqual(limit);
      }),
      { numRuns: 3000 },
    );
  });

  it('buildReport: 같은 성질이 보고 전체에도 성립한다', () => {
    fc.assert(
      fc.property(fc.array(line, { maxLength: 40 }), fc.array(line, { maxLength: 40 }), fc.constantFrom(200, 120, 60), fc.integer({ min: 1, max: 12 }), (failures, tasks, limit, maxMessages) => {
        const out = buildReport(
          { now: new Date('2026-10-17T00:00:00Z'), tasksToday: tasks.map((name) => ({ name, memo: '' })), created: [], uncertain: [], failures },
          limit,
          maxMessages,
        );
        expect(out.length).toBeLessThanOrEqual(maxMessages);
        for (const b of out) expect(count(b)).toBeLessThanOrEqual(limit);
      }),
      { numRuns: 1500 },
    );
  });
});
