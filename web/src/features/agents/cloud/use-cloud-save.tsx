import { useState } from "react";
import { isVersionConflict, request, type ApiResponse } from "@/api/client";
import { Button } from "@/components/button";
import { ErrorNotice, Notice } from "@/components/feedback";
import { useUnsaved } from "@/hooks/use-unsaved";
import type { Versioned } from "@/types/agents";
import { agentAdminRoot } from "../data/agent-api";
import { useAgentCommand, useCommandResult } from "../data/agent-runtime";

export function useCloudSave<T extends Versioned>({
  path,
  commandName,
  scope,
  initial,
  dirty,
  adopt,
  onSaved,
}: {
  path: string;
  commandName: string;
  scope: string;
  initial: ApiResponse<T>;
  dirty: boolean;
  adopt: (value: T) => void;
  onSaved: () => void;
}) {
  const action = useAgentCommand<T>(`${commandName}:${scope}`);
  const [etag, setEtag] = useState(initial.etag),
    [error, setError] = useState<unknown>(),
    [latest, setLatest] = useState<ApiResponse<T>>(),
    [reading, setReading] = useState(false);
  const conflict = isVersionConflict(action.state.error);
  const blocked = action.uncertain || conflict || !etag;
  const release = useUnsaved(dirty, action.pending || blocked);
  useCommandResult(action.state, (value) => {
    setEtag(action.state.response?.etag ?? "");
    adopt(value);
    setLatest(undefined);
    release();
    action.command.reset();
    onSaved();
  });
  return {
    pending: action.pending,
    blocked,
    etag,
    save: (body: unknown) =>
      action.command.run({
        domain: agentAdminRoot,
        path: path.slice(agentAdminRoot.length),
        command: commandName,
        scope,
        options: { method: "PUT", etag, body },
      }),
    recovery: (
      <>
        {action.recovery}
        <ErrorNotice error={error} />
        {conflict && (
          <Notice tone="warning" title="配置已被修改">
            当前草稿保留。读取最新配置后决定是否覆盖草稿。
            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                pending={reading}
                onClick={async () => {
                  setReading(true);
                  setError(undefined);
                  try {
                    setLatest(await request<T>(path));
                  } catch (e) {
                    setError(e);
                  } finally {
                    setReading(false);
                  }
                }}
              >
                读取最新配置
              </Button>
              {latest && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEtag(latest.etag);
                      adopt(latest.data);
                      setLatest(undefined);
                      action.command.reset();
                    }}
                  >
                    采用最新配置
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEtag(latest.etag);
                      setLatest(undefined);
                      action.command.reset();
                    }}
                  >
                    保留草稿并重新核对
                  </Button>
                </>
              )}
            </div>
          </Notice>
        )}
      </>
    ),
  };
}
