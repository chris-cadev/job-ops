import type { PipelineRun } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  getNextScheduledTick,
  getPreviousScheduledTick,
  resolveScheduledCron,
  shouldRunScheduledOnStartup,
} from "./scheduled-pipeline-run";

function scheduledRun(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    id: "run-1",
    startedAt: "2026-09-09T14:00:00.000Z",
    completedAt: "2026-09-09T14:05:00.000Z",
    status: "completed",
    jobsDiscovered: 1,
    jobsProcessed: 1,
    errorMessage: null,
    configSnapshot: null,
    ...overrides,
  };
}

describe("resolveScheduledCron", () => {
  it("prefers SCHEDULED_PIPELINE_CRON over the legacy hour", () => {
    expect(
      resolveScheduledCron({
        SCHEDULED_PIPELINE_CRON: "0 7 */2 * *",
        SCHEDULED_PIPELINE_HOUR: "9",
      } as NodeJS.ProcessEnv),
    ).toEqual({ cron: "0 7 */2 * *", timezone: "America/Tijuana" });
  });

  it("falls back to the legacy daily hour", () => {
    expect(
      resolveScheduledCron({
        SCHEDULED_PIPELINE_HOUR: "9",
        SCHEDULED_PIPELINE_TIMEZONE: "UTC",
      } as NodeJS.ProcessEnv),
    ).toEqual({ cron: "0 9 * * *", timezone: "UTC" });
  });

  it("clamps an invalid legacy hour to 7", () => {
    expect(
      resolveScheduledCron({
        SCHEDULED_PIPELINE_HOUR: "99",
      } as NodeJS.ProcessEnv).cron,
    ).toBe("0 7 * * *");
  });
});

describe("scheduled ticks", () => {
  it("spaces every-two-days ticks ~48h apart", () => {
    const schedule = { cron: "0 7 */2 * *", timezone: "America/Tijuana" };
    const from = new Date("2026-09-09T15:00:00.000Z");
    const next = getNextScheduledTick({ ...schedule, from });
    const previous = getPreviousScheduledTick({ ...schedule, from });
    expect(previous?.toISOString()).toBe("2026-09-09T14:00:00.000Z");
    expect(next.toISOString()).toBe("2026-09-11T14:00:00.000Z");
  });

  it("rejects invalid cron and timezone", () => {
    expect(() =>
      getNextScheduledTick({ cron: "not a cron", timezone: "UTC" }),
    ).toThrow();
    expect(() =>
      getNextScheduledTick({ cron: "0 7 * * *", timezone: "Bogus/Zone" }),
    ).toThrow();
  });
});

describe("shouldRunScheduledOnStartup", () => {
  const previousTick = new Date("2026-09-09T14:00:00.000Z");

  it("runs when no scheduled run exists yet", () => {
    expect(
      shouldRunScheduledOnStartup({ lastScheduledRun: null, previousTick }),
    ).toMatchObject({ run: true });
  });

  it("runs when the last scheduled run missed the previous tick", () => {
    expect(
      shouldRunScheduledOnStartup({
        lastScheduledRun: scheduledRun({
          startedAt: "2026-09-07T14:00:00.000Z",
        }),
        previousTick,
      }),
    ).toMatchObject({ run: true, reason: "missed-tick" });
  });

  it("retries failed or interrupted runs from the current tick", () => {
    for (const status of ["failed", "running"] as const) {
      expect(
        shouldRunScheduledOnStartup({
          lastScheduledRun: scheduledRun({ status }),
          previousTick,
        }).run,
      ).toBe(true);
    }
  });

  it("skips completed or cancelled runs from the current tick", () => {
    for (const status of ["completed", "cancelled"] as const) {
      expect(
        shouldRunScheduledOnStartup({
          lastScheduledRun: scheduledRun({ status }),
          previousTick,
        }),
      ).toMatchObject({ run: false });
    }
  });
});
