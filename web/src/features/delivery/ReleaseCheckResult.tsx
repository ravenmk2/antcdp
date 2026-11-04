import { forwardRef } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Command, MaterialSet } from "./releases";

export type ReleaseCheck = {
  preview_token: string;
  problems: string[];
  repositories: {
    id: string;
    full_path: string;
    commit_sha: string;
    extra: { id: string; title: string }[];
    problems: string[];
  }[];
};

export function checkProblemCount(check: ReleaseCheck) {
  return (
    check.problems.length +
    check.repositories.reduce(
      (total, repo) => total + repo.problems.length + repo.extra.length,
      0,
    )
  );
}

export const ReleaseCheckResult = forwardRef<
  HTMLElement,
  {
    check: ReleaseCheck;
    stale: boolean;
    canManage: boolean;
    pending: boolean;
    repositories: MaterialSet["repositories"];
    act: (op: string, command?: Partial<Command>) => void;
  }
>(function ReleaseCheckResult(
  { check, stale, canManage, pending, repositories, act },
  ref,
) {
  const problems = checkProblemCount(check);
  const ready = !problems && Boolean(check.preview_token);
  const affected = check.repositories.filter(
    (repo) => repo.problems.length || repo.extra.length,
  );
  return (
    <section
      ref={ref}
      tabIndex={-1}
      className="release-check"
      aria-label="送验核对结果"
    >
      <div className="release-check-heading">
        {!ready || stale ? (
          <AlertCircle aria-hidden="true" />
        ) : (
          <CheckCircle2 aria-hidden="true" />
        )}
        <div>
          <h2>
            {stale
              ? "核对结果已过期"
              : problems
                ? `核对发现 ${problems} 项待处理`
                : ready
                  ? "版本与材料核对通过"
                  : "核对尚未完成"}
          </h2>
          <p className="release-empty-copy">
            {stale
              ? "发布已更新，请重新核对后再冻结送验。"
              : `${check.repositories.length} 个仓库已返回核对结果。${problems ? "处理以下问题后重新核对。" : !ready ? "请重新核对后再送验。" : canManage ? "可从阶段面板冻结并送验。" : "可查看完整核对清单。"}`}
          </p>
        </div>
      </div>
      {!stale && (
        <>
          {check.problems.length > 0 && (
            <ul className="release-check-problems">
              {check.problems.map((problem, index) => (
                <li key={index}>{problem}</li>
              ))}
            </ul>
          )}
          {affected.map((repo) => (
            <section className="release-check-repo" key={repo.id}>
              <h3>{repo.full_path}</h3>
              {repo.problems.length > 0 && (
                <ul className="release-check-problems">
                  {repo.problems.map((problem, index) => (
                    <li key={index}>{problem}</li>
                  ))}
                </ul>
              )}
              {repo.extra.map((commit) => (
                <div className="release-extra-commit" key={commit.id}>
                  <div>
                    <p>{commit.title || "未登记提交"}</p>
                    <code>{commit.id}</code>
                  </div>
                  {canManage &&
                    repositories.some((item) => item.id === repo.id) && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          act("include-commit", {
                            ref: commit.id,
                            repo: repositories.find(
                              (item) => item.id === repo.id,
                            ),
                          })
                        }
                      >
                        补录提交
                      </Button>
                    )}
                </div>
              ))}
            </section>
          ))}
        </>
      )}
      <details className="release-check-snapshot">
        <summary>
          查看{stale ? "上次" : "完整"}核对清单 · {check.repositories.length}{" "}
          个仓库
        </summary>
        <ul>
          {check.repositories.map((repo) => (
            <li key={repo.id}>
              <span>{repo.full_path}</span>
              <code>{repo.commit_sha || "未取得提交"}</code>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
});
