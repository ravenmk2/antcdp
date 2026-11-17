import { expect, it } from "vitest";
import { draftArgumentStrings } from "@/features/agents/data/tool-summary";

it("extracts complete top-level paths without waiting for the file contents", () => {
  expect(
    draftArgumentStrings('{"path":"report.txt","content":"unfinished'),
  ).toEqual({ path: "report.txt" });
  expect(draftArgumentStrings('{"path":"unfinished')).toEqual({});
  expect(
    draftArgumentStrings('{"content":"path: \\"fake\\"", "path":"real.txt",'),
  ).toEqual({ content: 'path: "fake"', path: "real.txt" });
  expect(
    draftArgumentStrings('{"nested":{"path":"wrong"},"path":"right"'),
  ).toEqual({ path: "right" });
  expect(draftArgumentStrings('{"path":"C:\\\\temp\\\\测试.txt",')).toEqual({
    path: "C:\\temp\\测试.txt",
  });
  expect(draftArgumentStrings('[{"path":"wrong"}]')).toEqual({});
  expect(
    draftArgumentStrings(
      '{"path":"report.txt","content":"' + "x".repeat(100000),
    ),
  ).toEqual({ path: "report.txt" });
});
