import { describe, expect, it } from "vitest";
import { recommendedLabel } from "@/features/agents/chat/question-content";

describe("question recommendation compatibility", () => {
  it("uses explicit metadata before legacy label suffixes", () => {
    expect(recommendedLabel("测试环境", true)).toEqual({
      text: "测试环境",
      recommended: true,
    });
    expect(recommendedLabel("测试环境（推荐）", false)).toEqual({
      text: "测试环境",
      recommended: false,
    });
    expect(recommendedLabel("测试环境 (Recommended)")).toEqual({
      text: "测试环境",
      recommended: true,
    });
    expect(recommendedLabel("测试环境（推荐）")).toEqual({
      text: "测试环境",
      recommended: true,
    });
    expect(recommendedLabel("测试环境").recommended).toBe(false);
  });
});
