import { logger } from "@infra/logger";
import { getActiveTenantId } from "@server/tenancy/context";

/**
 * Pipeline event payloads.
 */
export interface PipelineEventMap {
  "job:scoring-failed": {
    jobId: string;
    error: string;
    attempt: number;
    maxRetries: number;
  };
}

type EventName = keyof PipelineEventMap;
type EventHandler<E extends EventName> = (payload: PipelineEventMap[E]) => void;

/**
 * Lightweight in-process event bus for pipeline events.
 * Tenant-scoped: each tenant gets its own bus instance.
 * Handlers run synchronously in the emit call; async handlers must
 * manage their own microtasks.
 */
class PipelineEventBus {
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();

  on<E extends EventName>(event: E, handler: EventHandler<E>): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as (...args: unknown[]) => void);
    this.handlers.set(event, set);
    return () => {
      set.delete(handler as (...args: unknown[]) => void);
    };
  }

  emit<E extends EventName>(event: E, payload: PipelineEventMap[E]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (error) {
        logger.error("Pipeline event handler threw", {
          event,
          error,
        });
      }
    }
  }

  removeAll(): void {
    this.handlers.clear();
  }
}

const instances = new Map<string, PipelineEventBus>();

/**
 * Get or create a PipelineEventBus for the given tenant (or the active tenant).
 */
export function getPipelineEventBus(tenantId?: string): PipelineEventBus {
  const tid = tenantId ?? getActiveTenantId();
  let bus = instances.get(tid);
  if (!bus) {
    bus = new PipelineEventBus();
    instances.set(tid, bus);
  }
  return bus;
}

/**
 * Remove the event bus instance for a tenant (e.g. on pipeline teardown).
 */
export function destroyPipelineEventBus(tenantId?: string): void {
  const tid = tenantId ?? getActiveTenantId();
  const bus = instances.get(tid);
  if (bus) {
    bus.removeAll();
    instances.delete(tid);
  }
}
