import { useSession } from "@/app/auth";
import type { AgentProjectOption } from "@/types/agents";
import { ResourcePicker } from "@/features/agents/resources/resource-picker";

export function ProjectContextPicker({
  ownerScope,
  options,
  onChoose,
  onClose,
}: {
  ownerScope: boolean;
  options: AgentProjectOption[];
  onChoose: (projectId: string) => void;
  onClose: () => void;
}) {
  const { user } = useSession();
  return (
    <ResourcePicker<AgentProjectOption>
      title="选择项目上下文"
      path={
        ownerScope
          ? `/projects?scope=${user.role === "admin" ? "all" : "mine"}&status=active`
          : undefined
      }
      options={ownerScope ? undefined : options}
      identify={(item) => item.id}
      label={(item) => item.name}
      onChoose={(item) => onChoose(item.id)}
      onClose={onClose}
    />
  );
}
