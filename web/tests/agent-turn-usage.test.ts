import { expect, it } from "vitest";
import { summarizeTurnUsage } from "@/features/agents/chat/turn-usage";
import type { ModelCallMetadata } from "@/types/agents";

function call(
  input: string | null,
  output: string | null,
  read: string | null,
): ModelCallMetadata {
  return {
    usage: {
      input_tokens: input,
      output_tokens: output,
      cache_read_tokens: read,
      cache_write_tokens: null,
    },
    usage_completeness: input === null ? "unknown" : "partial",
  } as ModelCallMetadata;
}
it("sums large counters exactly and weights cache hits only over valid request pairs", () => {
  const total = summarizeTurnUsage([
    call("9007199254740992", "7", "4503599627370496"),
    call(null, "3", null),
    call("1", null, "2"),
  ]);
  expect(total.input_tokens).toBe("9007199254740993");
  expect(total.output_tokens).toBe("10");
  expect(total.cache_write_tokens).toBeNull();
  expect(total.cacheHit).toBe(50);
  expect(total.covered).toBe(1);
  expect(total.partial).toBe(true);
});
it("does not turn missing usage into zero", () => {
  expect(summarizeTurnUsage([call(null, null, null)]).input_tokens).toBeNull();
  expect(summarizeTurnUsage([call("0", "0", "0")]).input_tokens).toBe("0");
});
