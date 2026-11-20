import { LockKeyhole } from "lucide-react";
import type { ComponentProps } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ModelOption, ModelSelection } from "@/types/agents";

export function ModelSelectionControls({
  models,
  value,
  onChange,
  locked = false,
  disabled = false,
  modelName,
  thinkingLabel,
}: {
  models: ModelOption[];
  value: ModelSelection;
  onChange: (value: ModelSelection) => void;
  locked?: boolean;
  disabled?: boolean;
  modelName?: string;
  thinkingLabel?: string;
}) {
  const selected = models.find(
    (model) => model.binding_id === value.model_binding_id,
  );
  const thinking = selected?.thinking_options ?? [];
  return (
    <div className="agent-model-controls">
      {locked ? (
        <span
          className="agent-composer-model agent-model-locked"
          title="模型已锁定，以保留当前上下文和文件引用"
        >
          <span className="truncate">
            {modelName ?? selected?.display_name}
          </span>
          <LockKeyhole className="size-3 shrink-0" aria-label="模型已锁定" />
        </span>
      ) : (
        <PopupSelect
          name="model"
          value={value.model_binding_id}
          disabled={disabled || !models.length}
          options={models.map((model) => ({
            value: model.binding_id,
            label: model.display_name,
            description: model.provider_label,
          }))}
          onValueChange={(id) => {
            const model = models.find((item) => item.binding_id === id);
            const next =
              model?.thinking_options.find(
                (item) => item.key === value.thinking_option_key,
              ) ??
              model?.thinking_options.find(
                (item) => item.key === model.default_thinking_option_key,
              ) ??
              model?.thinking_options[0];
            if (model)
              onChange({
                model_binding_id: id,
                thinking_option_key: next?.key ?? "",
              });
          }}
          triggerProps={{
            className: "agent-composer-model",
            "aria-label": "选择模型",
          }}
          contentProps={{
            side: "top",
            className: "max-h-80 max-w-[calc(100vw-2rem)]",
          }}
        />
      )}
      {thinking.length > 1 ? (
        <PopupSelect
          name="thinking"
          value={value.thinking_option_key}
          disabled={disabled}
          options={thinking.map((option) => ({
            value: option.key,
            label: option.label,
          }))}
          onValueChange={(key) =>
            onChange({ ...value, thinking_option_key: key })
          }
          triggerProps={{
            className: "agent-composer-model",
            "aria-label": "选择思考强度",
            title: locked ? "思考强度从下一轮执行生效" : "思考强度",
          }}
          contentProps={{ side: "top", className: "max-h-80" }}
        />
      ) : (
        <span className="agent-model-thinking">
          {thinkingLabel ?? thinking[0]?.label}
        </span>
      )}
    </div>
  );
}

function PopupSelect({
  name,
  value,
  onValueChange,
  options,
  disabled,
  triggerProps,
  contentProps,
}: {
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string; description?: string }[];
  disabled?: boolean;
  triggerProps: ComponentProps<typeof SelectTrigger>;
  contentProps: ComponentProps<typeof SelectContent>;
}) {
  return (
    <Select
      name={name}
      value={value}
      items={options}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <SelectTrigger {...triggerProps}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent {...contentProps}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="block">{option.label}</span>
            {option.description && (
              <span className="block text-xs text-muted">
                {option.description}
              </span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
