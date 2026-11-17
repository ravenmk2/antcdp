import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ScriptEditor } from "@/components/script-editor";

it("retains the current script when saving makes the editor read-only", () => {
  const { rerender } = render(
    <ScriptEditor value="originalScript" onChange={() => {}} />,
  );
  rerender(<ScriptEditor value="editedScript" onChange={() => {}} readOnly />);
  expect(screen.getByText("editedScript")).toBeVisible();
  expect(screen.queryByText("originalScript")).not.toBeInTheDocument();
  rerender(<ScriptEditor value="editedScript" onChange={() => {}} />);
  expect(screen.getByText("editedScript")).toBeVisible();
});
