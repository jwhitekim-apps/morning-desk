// my-task original code (not derived from upstream).
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildReport, type ReportInput, type ServerSection, type SourceSection } from '../src/briefing/report';

const empty: ReportInput = { now: new Date('2026-10-07T22:00:00Z'), tasksToday: [], created: [], uncertain: [], failures: [] };
const text = (input: Partial<ReportInput>, limit = 1000, max = 3) => buildReport({ ...empty, ...input }, limit, max).join('\n');
const idx = (t: string, s: string) => {
  const i = t.indexOf(s);
  assert.ok(i >= 0, `${s} missing in\n${t}`);
  return i;
};

test('the title says briefing and never morning', () => {
  const first = text({}).split('\n')[0] ?? '';
  assert.match(first, /^10\/8\(목\) 브리핑$/);
  assert.doesNotMatch(first, /아침/);
});

test('a source with zero items keeps its section', () => {
  const t = text({ sourceSections: [{ name: 'GitHub', count: 0, titles: [] }] });
  assert.match(t, /\[GitHub · 이번에 새로 읽은 0건\]\n읽은 것 없음/);
});

test('section titles use the unit of each source', () => {
  const t = text({ sourceSections: [{ name: '메일', count: 2, titles: ['a', 'b'] }, { name: '폴리오', count: 1, titles: ['p'] }] });
  assert.match(t, /\[메일 · 이번에 새로 읽은 2통\]\n· a\n· b/);
  assert.match(t, /\[폴리오 · 이번에 새로 읽은 1편\]\n· p/);
});

test('more than three titles show three and the rest as a count', () => {
  const titles = Array.from({ length: 8 }, (_, i) => `제목 ${i + 1}`);
  const t = text({ sourceSections: [{ name: '메일', count: 8, titles }] });
  assert.equal((t.match(/^· 제목 \d$/gm) ?? []).length, 3);
  assert.match(t, /^…외 5건$/m);
});

test('count larger than the titles passed still reports the remainder', () => {
  const t = text({ sourceSections: [{ name: '메일', count: 12, titles: ['x'] }] });
  assert.match(t, /이번에 새로 읽은 12통\]\n· x\n…외 11건/);
});

test('titles are clipped to 40 characters', () => {
  const t = text({ sourceSections: [{ name: '메일', count: 1, titles: ['가'.repeat(100)] }] });
  const line = t.split('\n').find((l) => l.startsWith('· 가'))!;
  assert.equal(line.slice(2).length, 40);
  assert.ok(line.endsWith('…'));
});

test('a source section type carries titles only', () => {
  const s: SourceSection = { name: '메일', count: 1, titles: ['t'] };
  assert.deepEqual(Object.keys(s).sort(), ['count', 'name', 'titles']);
  // @ts-expect-error sender and body are not part of the type
  const bad: SourceSection = { ...s, from: 'a@b', body: 'x' };
  void bad;
});

test('disabled sources get one line and never appear as failures', () => {
  const t = text({ disabledSources: ['폴리오', 'GitHub'] });
  assert.match(t, /\[꺼진 소스\]\n· 폴리오, GitHub/);
  assert.doesNotMatch(t, /실패/);
  assert.doesNotMatch(t, /이번에 새로 읽은/);
});

test('a server issue comes before the source sections', () => {
  const server: ServerSection = { state: 'issues', problems: ['veloo 중단'] };
  const t = text({ server, sourceSections: [{ name: '메일', count: 1, titles: ['a'] }], tasksToday: [{ name: 'T', memo: '' }] });
  assert.ok(idx(t, '[⚠ 서버]\n· veloo 중단') < idx(t, '[오늘]'));
  assert.ok(idx(t, '[⚠ 서버]') < idx(t, '[메일 ·'));
});

test('server ok and skipped are single low lines', () => {
  const src: SourceSection[] = [{ name: '메일', count: 1, titles: ['a'] }];
  const ok = text({ server: { state: 'ok', problems: [] }, sourceSections: src, notes: ['안내'] });
  assert.ok(idx(ok, '서버 정상') > idx(ok, '[메일 ·'));
  assert.ok(idx(ok, '서버 정상') < idx(ok, '[참고]'));
  assert.doesNotMatch(ok, /⚠ 서버/);
  const skipped = text({ server: { state: 'skipped', problems: [] }, sourceSections: src });
  assert.match(skipped, /^서버 점검 건너뜀\(설정 없음\)$/m);
});

test('full order of sections', () => {
  const t = text({
    failures: ['f'],
    uncertain: ['u'],
    server: { state: 'issues', problems: ['s'] },
    top: [{ name: 'a', reason: 'r' }],
    tasksToday: [{ name: 'T', memo: '' }],
    overdue: [{ name: 'o', deadline: '2026-10-01' }],
    upcoming: [{ name: 'p', deadline: '2026-10-09' }],
    created: [{ name: 'c', deadline: '' }],
    undated: [{ name: 'd', note: '' }],
    sourceSections: [
      { name: '폴리오', count: 1, titles: ['p'] },
      { name: 'GitHub', count: 1, titles: ['g'] },
      { name: '메일', count: 1, titles: ['m'] },
    ],
    disabledSources: ['x'],
    notes: ['n'],
    remark: ['끝말'],
  }, 3000);
  const marks = ['[⚠ 실패]', '[확인]', '[⚠ 서버]', '[먼저 할 일]', '[오늘]', '[밀린 일]', '[임박]', '[새로 찾은 일]', '[할 일]', '[메일 ·', '[GitHub ·', '[폴리오 ·', '[꺼진 소스]', '[참고]', '끝말'].map((s) => idx(t, s));
  assert.deepEqual([...marks].sort((a, b) => a - b), marks);
});

test('with little room, trailing sections are dropped first and the omitted count shows', () => {
  const tasksToday = Array.from({ length: 6 }, (_, i) => ({ name: `오늘 일 ${i}`, memo: '' }));
  const messages = buildReport(
    {
      ...empty,
      failures: ['중요한 실패'],
      tasksToday,
      sourceSections: [{ name: '메일', count: 2, titles: ['m1', 'm2'] }, { name: 'GitHub', count: 1, titles: ['g'] }],
      disabledSources: ['폴리오'],
      notes: ['참고 안내'],
    },
    120,
    1,
  );
  const t = messages.join('\n');
  assert.ok(messages.every((m) => m.length <= 120));
  assert.match(t, /중요한 실패/);
  assert.doesNotMatch(t, /\[참고\]/);
  assert.doesNotMatch(t, /\[꺼진 소스\]/);
  assert.doesNotMatch(t, /\[GitHub ·/);
  assert.match(t, /…외 \d+건 생략$/);
});
