import { expect, it } from "vitest";
import {
  generationDraft,
  generationParameters,
} from "@/features/agents/resources/generation-parameters";

it("preserves zero sampling values and multi-line stop sequences on a binding", () => {
  const values = {
    response_format: {
      type: "json_schema",
      schema: { type: "object", required: ["answer"] },
    },
    temperature: 0,
    top_p: 0,
    max_output_tokens: 2048,
    stop: ["\n\n", "结束"],
  };
  expect(generationParameters(generationDraft(values), 2048)).toEqual(values);
  expect(generationParameters(generationDraft({}), 2048)).toEqual({});
});

it("checks the model output limit and the UTF-8 length of stop sequences", () => {
  expect(() =>
    generationParameters(generationDraft({ max_output_tokens: 2049 }), 2048),
  ).toThrow();
  expect(() =>
    generationParameters(generationDraft({ stop: ["停".repeat(43)] })),
  ).toThrow();
});
