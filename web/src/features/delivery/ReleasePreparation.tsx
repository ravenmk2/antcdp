import { Link } from "react-router";
import type { Variant } from "@/shared/delivery";

export function ReleasePreparation({
  variant,
  root,
  manage,
  systemAdmin,
  draftScopeEmpty = false,
}: {
  variant: Variant;
  root: string;
  manage: boolean;
  systemAdmin: boolean;
  draftScopeEmpty?: boolean;
}) {
  const empty = variant.repository_count === 0;
  const projectId = root.split("/").at(-1);
  return (
    <div className="space-y-2 text-[13px] text-muted-foreground">
      <p>
        纯材料发布可以不包含
        MR。开始发布前仍需至少一个范围仓库，并确认每个仓库的基线；环境可按需配置。
      </p>
      {empty || draftScopeEmpty ? (
        <>
          <p>
            {empty
              ? "当前产品分支范围内没有仓库，可先保存草稿和准备材料。"
              : "本次草稿尚未包含仓库，请先刷新发布范围并确认基线。"}
            {empty &&
              (manage
                ? "请核对项目仓库关联及产品分支范围，再到发布中刷新范围。"
                : "请项目管理员核对产品分支范围；项目仓库关联由系统管理员维护。")}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Link
              className="underline underline-offset-4"
              to={`${root}/variants?variant=${variant.id}&vview=repositories`}
            >
              {manage ? "检查产品分支仓库范围" : "查看产品分支仓库范围"}
            </Link>
            {empty &&
              (systemAdmin ? (
                <Link
                  className="underline underline-offset-4"
                  to={`/admin/projects/${projectId}?tab=repositories`}
                >
                  在控制台关联仓库
                </Link>
              ) : (
                manage && <span>关联仓库需由系统管理员在控制台维护。</span>
              ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
