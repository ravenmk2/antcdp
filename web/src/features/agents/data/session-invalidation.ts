import type { QueryClient } from "@tanstack/react-query";

// Batch commit bursts without postponing a refresh indefinitely during a run.
// The server sends hints only; list ordering, permissions and pagination remain
// authoritative in the HTTP projection.
export class SessionInvalidation {
  private timer?: ReturnType<typeof setTimeout>;
  private dirty = false;
  private running = false;
  private disposed = false;
  constructor(private readonly cache: QueryClient) {}
  changed = () => {
    if (this.disposed) return;
    this.dirty = true;
    if (this.timer || this.running) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 200);
  };
  private async flush() {
    this.running = true;
    const keys = ["agent-sessions", "workspace-attention"];
    // Do not cancel pagination or an initial read. A hint arriving during an
    // in-flight read must trigger another read after it has settled.
    await Promise.allSettled(
      keys
        .flatMap((key) =>
          this.cache.getQueryCache().findAll({ queryKey: [key] }),
        )
        .map((query) => query.promise),
    );
    if (!this.disposed) {
      this.dirty = false;
      await Promise.allSettled(
        keys.map((key) =>
          this.cache.invalidateQueries(
            { queryKey: [key] },
            { cancelRefetch: false },
          ),
        ),
      );
    }
    this.running = false;
    if (this.dirty && !this.disposed) this.changed();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
