import { Check } from "lucide-react";

export function WizardSteps({
  steps,
  current,
}: {
  steps: string[];
  current: number;
}) {
  return (
    <ol className="wizard-steps" aria-label="流程步骤">
      {steps.map((step, index) => (
        <li
          key={step}
          className="wizard-step"
          data-state={
            index < current ? "done" : index === current ? "active" : "pending"
          }
          aria-current={index === current ? "step" : undefined}
        >
          <span className="wizard-index">
            {index < current ? <Check className="size-3" /> : index + 1}
          </span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}
