import * as api from "@client/api";
import { renderHookWithQueryClient } from "@client/test/renderWithQueryClient";
import type { JobListItem } from "@shared/types.js";
import { act, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { trackProductEvent } from "@/lib/analytics";
import { useJobSelectionActions } from "./useJobSelectionActions";

vi.mock("@client/api", () => ({
  streamJobAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(() => "progress-toast"),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/lib/analytics", () => ({
  trackProductEvent: vi.fn(),
}));

const INVALID_KEY_MESSAGE =
  "Reactive Resume v5 API key is invalid. Update the API key and try again.";

function makeJob(id: string): JobListItem {
  return { id, status: "discovered" } as JobListItem;
}

function emitCompletedRun(results: any[]) {
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  const summary = {
    action: "move_to_ready" as const,
    requested: results.length,
    completed: results.length,
    succeeded,
    failed,
    requestId: "req-1",
  };
  vi.mocked(api.streamJobAction).mockImplementation(
    async (_input, handlers) => {
      handlers.onEvent({ ...summary, completed: 0, type: "started" });
      for (const result of results) {
        handlers.onEvent({
          ...summary,
          completed: 1,
          type: "progress",
          result,
        });
      }
      handlers.onEvent({ ...summary, type: "completed", results });
    },
  );
}

describe("useJobSelectionActions move_to_ready failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the invalid-key message with a Settings link and keeps failed jobs selected", async () => {
    emitCompletedRun([
      { jobId: "job-ok", ok: true, job: makeJob("job-ok") },
      {
        jobId: "job-bad",
        ok: false,
        error: { code: "UNAUTHORIZED", message: INVALID_KEY_MESSAGE },
      },
    ]);
    const loadJobs = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHookWithQueryClient(() =>
      useJobSelectionActions({
        activeJobs: [makeJob("job-ok"), makeJob("job-bad")],
        activeTab: "discovered",
        loadJobs,
      }),
    );

    act(() => {
      result.current.toggleSelectJob("job-ok");
      result.current.toggleSelectJob("job-bad");
    });
    await act(async () => {
      await result.current.runJobAction("move_to_ready");
    });

    expect(trackProductEvent).toHaveBeenCalledWith(
      "jobs_bulk_action_completed",
      expect.objectContaining({ succeeded: 1, failed: 1 }),
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [title, options] = vi.mocked(toast.error).mock.calls[0];
    expect(title).toContain("1 succeeded, 1 failed");
    render(options?.description as ReactElement);
    expect(screen.getByText(INVALID_KEY_MESSAGE)).toBeTruthy();
    const link = screen.getByRole("link", {
      name: /open settings to update the api key/i,
    });
    expect(link.getAttribute("href")).toBe("/settings#reactive-resume");

    expect(result.current.selectedJobIds.has("job-bad")).toBe(true);
    expect(result.current.selectedJobIds.has("job-ok")).toBe(false);
  });

  it("keeps the plain success message for normal renders", async () => {
    emitCompletedRun([{ jobId: "job-1", ok: true, job: makeJob("job-1") }]);
    const loadJobs = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHookWithQueryClient(() =>
      useJobSelectionActions({
        activeJobs: [makeJob("job-1")],
        activeTab: "discovered",
        loadJobs,
      }),
    );

    act(() => {
      result.current.toggleSelectJob("job-1");
    });
    await act(async () => {
      await result.current.runJobAction("move_to_ready");
    });

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.success).mock.calls[0][0]).toBe(
      "1 jobs moved to Ready",
    );
  });

  it("keeps the generic toast for non-auth failures", async () => {
    emitCompletedRun([
      {
        jobId: "job-bad",
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "Tailoring failed: boom" },
      },
    ]);
    const loadJobs = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHookWithQueryClient(() =>
      useJobSelectionActions({
        activeJobs: [makeJob("job-bad")],
        activeTab: "discovered",
        loadJobs,
      }),
    );

    act(() => {
      result.current.toggleSelectJob("job-bad");
    });
    await act(async () => {
      await result.current.runJobAction("move_to_ready");
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    const [title, options] = vi.mocked(toast.error).mock.calls[0];
    expect(title).toContain("0 succeeded, 1 failed");
    expect(options?.description).toBeUndefined();
  });
});
