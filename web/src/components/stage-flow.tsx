import { Check } from "lucide-react";
import { releaseStatus } from "@/domain/labels";

const stages = [
  "draft",
  "integrating",
  "reviewing",
  "accepted",
  "tagging",
  "archived",
];

export function StageFlow({ status }: { status: string }) {
  const current = stages.indexOf(status);
  return (
    <ol className="stage-flow" aria-label="发布阶段">
      {stages.map((stage, index) => {
        const state =
          index < current ? "done" : index === current ? "current" : "pending";
        return (
          <li key={stage} className="stage" data-state={state}>
            <span className="stage-node" aria-hidden>
              {state === "done" ? <Check /> : null}
            </span>
            <span>{releaseStatus(stage)}</span>
          </li>
        );
      })}
    </ol>
  );
}
