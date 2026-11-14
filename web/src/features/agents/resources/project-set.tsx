import { useState, type ComponentProps } from "react";
import { useQueries } from "@tanstack/react-query";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { useFieldProps } from "@/components/fields";
import { Notice } from "@/components/feedback";
import type { Resource } from "@/types/collaboration";
import { ResourcePicker } from "@/features/agents/resources/resource-picker";

export function ProjectSet({
  ids,
  onChange,
  disabled = false,
  warnInactive = false,
  name,
  controlProps,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  warnInactive?: boolean;
  name?: string;
  controlProps?: ComponentProps<typeof Button>;
  disabled?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const projects = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["project", id],
      queryFn: () => request<Resource>(`/projects/${id}`),
      retry: false,
    })),
  });
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {ids.map((id, index) => {
          const project = projects[index]?.data?.data;
          const label = project?.name ?? `项目 ${id}`;
          return (
            <Button
              key={id}
              variant="outline"
              disabled={disabled}
              aria-label={`移除${label}`}
              onClick={() => onChange(ids.filter((value) => value !== id))}
            >
              {label}
              {project?.status === "archived" ? "（已归档）" : ""} ×
            </Button>
          );
        })}
        <Button
          {...controlProps}
          data-field-name={name}
          variant="outline"
          disabled={disabled || ids.length >= 100}
          onClick={() => setPicking(true)}
        >
          添加项目
        </Button>
      </div>
      {warnInactive &&
        projects.length > 0 &&
        projects.every((query) => query.data?.data.status === "archived") && (
          <Notice tone="warning">
            关联项目均已归档，用户当前无法启动该智能体。
          </Notice>
        )}
      {picking && (
        <ResourcePicker<Resource>
          title="选择项目"
          path="/projects?scope=all&status=active"
          identify={(item) => item.id}
          label={(item) => item.name}
          description={(item) => item.summary}
          disabled={(item) => ids.includes(item.id) || ids.length >= 100}
          onChoose={(item) => {
            onChange([...ids, item.id]);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

export function ProjectSetField(
  props: Omit<ComponentProps<typeof ProjectSet>, "controlProps">,
) {
  const field = useFieldProps();
  return <ProjectSet {...props} controlProps={field} />;
}
