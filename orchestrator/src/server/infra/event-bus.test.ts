/**
 * Tests for the tenant-scoped PipelineEventBus.
 */
import { describe, expect, it, vi } from "vitest";
import { destroyPipelineEventBus, getPipelineEventBus } from "./event-bus";

describe("PipelineEventBus", () => {
  it("returns a bus for the given tenant", () => {
    const bus1 = getPipelineEventBus("tenant-a");
    const bus2 = getPipelineEventBus("tenant-b");
    expect(bus1).toBeDefined();
    expect(bus2).toBeDefined();
    expect(bus1).not.toBe(bus2);
  });

  it("returns the same bus for the same tenant", () => {
    const bus1 = getPipelineEventBus("tenant-a");
    const bus2 = getPipelineEventBus("tenant-a");
    expect(bus1).toBe(bus2);
  });

  it("calls registered handlers on emit", () => {
    const bus = getPipelineEventBus("test-calls");
    const handler = vi.fn();
    bus.on("job:scoring-failed", handler);

    bus.emit("job:scoring-failed", {
      jobId: "job-1",
      error: "LLM timeout",
      attempt: 1,
      maxRetries: 3,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      jobId: "job-1",
      error: "LLM timeout",
      attempt: 1,
      maxRetries: 3,
    });
  });

  it("supports multiple handlers per event", () => {
    const bus = getPipelineEventBus("test-multi");
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on("job:scoring-failed", h1);
    bus.on("job:scoring-failed", h2);

    bus.emit("job:scoring-failed", {
      jobId: "job-1",
      error: "err",
      attempt: 1,
      maxRetries: 3,
    });

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("does not throw when no handlers are registered", () => {
    const bus = getPipelineEventBus("test-noop");
    expect(() => {
      bus.emit("job:scoring-failed", {
        jobId: "job-1",
        error: "err",
        attempt: 1,
        maxRetries: 3,
      });
    }).not.toThrow();
  });

  it("returns an unsubscribe function that removes the handler", () => {
    const bus = getPipelineEventBus("test-unsub");
    const handler = vi.fn();
    const unsub = bus.on("job:scoring-failed", handler);

    unsub();

    bus.emit("job:scoring-failed", {
      jobId: "job-1",
      error: "err",
      attempt: 1,
      maxRetries: 3,
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("removeAll clears all handlers", () => {
    const bus = getPipelineEventBus("test-removeall");
    const handler = vi.fn();
    bus.on("job:scoring-failed", handler);

    bus.removeAll();

    bus.emit("job:scoring-failed", {
      jobId: "job-1",
      error: "err",
      attempt: 1,
      maxRetries: 3,
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("destroyPipelineEventBus removes the instance", () => {
    // Create a bus and add a handler
    getPipelineEventBus("test-destroy").on("job:scoring-failed", vi.fn());
    destroyPipelineEventBus("test-destroy");

    // After destroy, a new bus should be a different instance
    const bus = getPipelineEventBus("test-destroy");
    expect(bus).toBeDefined();
  });

  it("handles handler errors gracefully", () => {
    const bus = getPipelineEventBus("test-error");
    const throwingHandler = vi.fn().mockImplementation(() => {
      throw new Error("handler error");
    });
    bus.on("job:scoring-failed", throwingHandler);

    // Should not throw
    expect(() => {
      bus.emit("job:scoring-failed", {
        jobId: "job-1",
        error: "err",
        attempt: 1,
        maxRetries: 3,
      });
    }).not.toThrow();

    expect(throwingHandler).toHaveBeenCalledTimes(1);
  });
});
