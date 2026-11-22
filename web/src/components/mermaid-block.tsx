import { Expand } from "lucide-react";
import { useState } from "react";
import { useTheme } from "@/app/theme";
import { useMermaidDiagram } from "@/hooks/use-mermaid-diagram";
import { IconButton } from "./button";
import { CodeBlock } from "./code-block";
import { CopyButton } from "./copy-button";
import { DiagramViewer } from "./diagram-viewer";
import { ErrorNotice } from "./feedback";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

export function MermaidBlock({
  source,
  streaming = false,
}: {
  source: string;
  streaming?: boolean;
}) {
  const { resolved } = useTheme();
  const [graph, setGraph] = useState(false);
  const [previewTrigger, setPreviewTrigger] =
    useState<HTMLButtonElement | null>(null);
  const { result, retry } = useMermaidDiagram(
    source,
    resolved,
    graph && !streaming,
  );
  const diagram = result?.diagram;
  return (
    <figure className="mermaid-block">
      <div className="flex items-center gap-1 border-b border-b-border-subtle px-3 py-2">
        <span className="mr-auto text-xs text-muted">Mermaid</span>
        {graph && <CopyButton label="复制 Mermaid 源码" value={source} />}
        {graph && diagram && (
          <IconButton
            label="放大查看图表"
            size="iconSm"
            onClick={(event) => setPreviewTrigger(event.currentTarget)}
          >
            <Expand />
          </IconButton>
        )}
        <ToggleGroup
          value={[graph ? "graph" : "code"]}
          onValueChange={([value]) => {
            if (value === "graph") {
              if (result?.error !== undefined) retry();
              setGraph(true);
            } else if (value === "code") {
              setGraph(false);
            }
          }}
          className="markdown-mode-switch"
          variant="default"
          spacing={1}
          aria-label="Mermaid 显示模式"
        >
          <ToggleGroupItem value="code">代码</ToggleGroupItem>
          <ToggleGroupItem value="graph" disabled={streaming}>
            图形
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {!graph || streaming ? (
        <CodeBlock
          source={source}
          language="mermaid"
          streaming={streaming}
          className="m-0 border-0 rounded-none"
        />
      ) : result?.error !== undefined ? (
        <div className="p-4">
          <ErrorNotice error={result.error} />
          <CodeBlock source={source} language="mermaid" />
        </div>
      ) : diagram ? (
        <button
          type="button"
          className="diagram-preview"
          aria-label="查看完整图表"
          onClick={(event) => setPreviewTrigger(event.currentTarget)}
        >
          <img src={diagram.image} alt="Mermaid 图表" draggable={false} />
        </button>
      ) : (
        <p className="p-5 text-sm text-muted" role="status">
          正在渲染图表…
        </p>
      )}
      {previewTrigger && diagram && (
        <DiagramViewer
          diagram={diagram}
          returnFocus={previewTrigger}
          onClose={() => setPreviewTrigger(null)}
        />
      )}
    </figure>
  );
}
