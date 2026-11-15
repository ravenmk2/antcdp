import { Navigate, useSearchParams } from "react-router";
import { WorkbenchScene } from "./workbench-scene";

export function Workbench() {
  const [params] = useSearchParams();
  const agent = params.get("agent");
  if (agent)
    return (
      <Navigate to={`/agents?agent=${encodeURIComponent(agent)}`} replace />
    );
  return (
    <div className="workspace-placeholder" aria-label="工作台">
      <WorkbenchScene />
    </div>
  );
}
