// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { fromGraph, toGraphUtc, toKstGraph } from "../src/lib/kst";

describe("fromGraph: Graph (UTC) -> Korea Standard Time", () => {
  // 실측값: 앱에서 날짜만 고른 마감이 이렇게 온다(한국 자정 = 전날 15:00 UTC).
  it("shows the three real samples as the day the user picked, not one day earlier", () => {
    expect(fromGraph({ dateTime: "2026-04-08T15:00:00.0000000", timeZone: "UTC" })).toEqual({ date: "2026-04-09", time: "00:00" });
    expect(fromGraph({ dateTime: "2026-04-04T15:00:00.0000000", timeZone: "UTC" })).toEqual({ date: "2026-04-05", time: "00:00" });
    expect(fromGraph({ dateTime: "2026-03-25T15:00:00.0000000", timeZone: "UTC" })).toEqual({ date: "2026-03-26", time: "00:00" });
  });

  it("puts Korea 00:30 on the 13th even though it is still the 12th in UTC", () => {
    expect(fromGraph({ dateTime: "2026-10-12T15:30:00.0000000", timeZone: "UTC" })).toEqual({ date: "2026-10-13", time: "00:30" });
  });

  it("keeps values already in Korea time, under either name", () => {
    expect(fromGraph({ dateTime: "2026-10-13T15:00:00", timeZone: "Asia/Seoul" })).toEqual({ date: "2026-10-13", time: "15:00" });
    expect(fromGraph({ dateTime: "2026-10-13T15:00:00", timeZone: "Korea Standard Time" })).toEqual({ date: "2026-10-13", time: "15:00" });
  });

  it("converts other IANA zones, including daylight saving time", () => {
    // 2026-07-01 12:00 New York (EDT, UTC-4) = 16:00 UTC = 2026-07-02 01:00 Korea
    expect(fromGraph({ dateTime: "2026-07-01T12:00:00", timeZone: "America/New_York" })).toEqual({ date: "2026-07-02", time: "01:00" });
    // 2026-01-01 12:00 New York (EST, UTC-5) = 17:00 UTC = 2026-01-02 02:00 Korea
    expect(fromGraph({ dateTime: "2026-01-01T12:00:00", timeZone: "America/New_York" })).toEqual({ date: "2026-01-02", time: "02:00" });
  });

  it("crosses month and year boundaries", () => {
    expect(fromGraph({ dateTime: "2026-12-31T15:00:00.0000000", timeZone: "UTC" })).toEqual({ date: "2027-01-01", time: "00:00" });
    expect(fromGraph({ dateTime: "2026-02-28T15:00:00.0000000", timeZone: "UTC" })).toEqual({ date: "2026-03-01", time: "00:00" });
  });

  it("refuses an unknown time zone instead of guessing", () => {
    expect(() => fromGraph({ dateTime: "2026-10-13T00:00:00", timeZone: "Mars/Olympus" })).toThrowError(/Unsupported time zone/);
  });
});

describe("toGraphUtc: input -> UTC for Graph", () => {
  it("a date alone means Korea midnight of that day (15:00 UTC the day before), like the app stores it", () => {
    expect(toGraphUtc("2026-10-13")).toEqual({ dateTime: "2026-10-12T15:00:00.0000000", timeZone: "UTC" });
  });

  it("a date-time without a zone is Korea time", () => {
    expect(toGraphUtc("2026-10-13T15:00")).toEqual({ dateTime: "2026-10-13T06:00:00.0000000", timeZone: "UTC" });
    expect(toGraphUtc("2026-10-13T15:00:30")).toEqual({ dateTime: "2026-10-13T06:00:30.0000000", timeZone: "UTC" });
  });

  it("honours an explicit offset or Z", () => {
    expect(toGraphUtc("2026-10-13T15:00:00Z")).toEqual({ dateTime: "2026-10-13T15:00:00.0000000", timeZone: "UTC" });
    expect(toGraphUtc("2026-10-13T15:00:00+09:00")).toEqual({ dateTime: "2026-10-13T06:00:00.0000000", timeZone: "UTC" });
    expect(toGraphUtc("2026-10-13T15:00:00-0500")).toEqual({ dateTime: "2026-10-13T20:00:00.0000000", timeZone: "UTC" });
  });

  it("uses the zone of an object input, defaulting to Korea time", () => {
    expect(toGraphUtc({ dateTime: "2026-07-01T12:00:00", timeZone: "America/New_York" })).toEqual({ dateTime: "2026-07-01T16:00:00.0000000", timeZone: "UTC" });
    expect(toGraphUtc({ dateTime: "2026-10-13T15:00:00" })).toEqual({ dateTime: "2026-10-13T06:00:00.0000000", timeZone: "UTC" });
  });

  it("rejects dates that do not exist, and malformed text", () => {
    for (const bad of ["2026-13-01", "2026-02-30", "2026-10-13T25:00", "2026-10-13T10:61", "내일", "", "2026/10/13"]) {
      expect(() => toGraphUtc(bad), bad).toThrowError(/Invalid date-time/);
    }
  });
});

describe("round trip (property based)", () => {
  // 한국 시간의 어떤 날짜·시각이든 보냈다가(UTC) 다시 읽으면 같은 날짜·시각이어야 한다. 하루 어긋남을 막는 핵심 성질.
  const wall = fc
    .record({
      date: fc.date({ min: new Date("2020-01-02T00:00:00Z"), max: new Date("2040-12-30T00:00:00Z"), noInvalidDate: true }),
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 0, max: 59 }),
    })
    .map(({ date, hour, minute }) => {
      const ymd = date.toISOString().slice(0, 10);
      const hh = String(hour).padStart(2, "0");
      const mm = String(minute).padStart(2, "0");
      return { ymd, time: `${hh}:${mm}` };
    });

  it("Korea wall time -> UTC -> Korea wall time is the identity, including around midnight", () => {
    fc.assert(
      fc.property(wall, ({ ymd, time }) => {
        const back = fromGraph(toGraphUtc(`${ymd}T${time}`));
        expect(back).toEqual({ date: ymd, time });
      }),
      { numRuns: 500 },
    );
  });

  it("a date alone round-trips to the same date at 00:00", () => {
    fc.assert(
      fc.property(wall, ({ ymd }) => {
        expect(fromGraph(toGraphUtc(ymd))).toEqual({ date: ymd, time: "00:00" });
      }),
      { numRuns: 300 },
    );
  });
});

describe("toKstGraph", () => {
  it("rewrites a UTC value as Korea time in the same Graph shape", () => {
    expect(toKstGraph({ dateTime: "2026-04-08T15:00:00.0000000", timeZone: "UTC" })).toEqual({ dateTime: "2026-04-09T00:00:00", timeZone: "Asia/Seoul" });
  });
});
