import { Link } from "react-router";
import { useState, type FormEvent } from "react";
import { request } from "@/api/client";
import { Drawer } from "@/components/overlays";
import { ErrorNotice } from "@/components/feedback";
import { Field, Input } from "@/components/fields";
import { RobotResources } from "@/features/agents/resources/robot-resources";
import { usernameSchema, displayNameSchema } from "@/domain/validation";
import { Button } from "@/components/button";
import { AsyncBoundary, StatusBadge } from "@/components/feedback";
import { StandaloneInput } from "@/components/fields";
import { PageHeader, Panel } from "@/components/layout";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { useDebouncedSearch } from "@/hooks/use-search";
import { useListParams } from "@/features/agents/resources/admin-shared";
import type { User } from "@/types/auth";

export function RobotsPage() {
  const [edit, setEdit] = useState<string>();
  const { params, page, size, change } = useListParams();
  const q = params.get("q") ?? "";
  const search = useDebouncedSearch(q, (value) =>
    change({ q: value, page: "1" }),
  );
  const query = useApiQuery<(User & { managed_agent_id: string | null })[]>(
    ["robots", q, page, size],
    `/admin/robots?${new URLSearchParams({ q, page: String(page), page_size: String(size) })}`,
  );
  return (
    <div className="page">
      <PageHeader
        title="机器人账号"
        description="独立管理执行身份、项目权限和账号凭据。机器人不能登录，可被订阅使用；服务型助手绑定后不可换绑。"
        actions={<Button onClick={() => setEdit("new")}>创建机器人</Button>}
      />
      <Panel bodyClassName="space-y-5 p-5">
        <div className="flex items-center justify-between">
          <StandaloneInput
            aria-label="搜索机器人"
            placeholder="搜索名称或账号"
            className="max-w-sm"
            value={search.value}
            onChange={(e) => search.setValue(e.target.value)}
          />
          <Button
            variant="outline"
            pending={query.isFetching}
            onClick={() => void query.refetch()}
          >
            刷新
          </Button>
        </div>
        <AsyncBoundary
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          empty={query.data?.data.length === 0}
          emptyTitle="暂无机器人账号"
        >
          <SimpleTable
            label="机器人账号"
            headers={["机器人", "状态", "绑定助手", "操作"]}
          >
            {query.data?.data.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.display_name}</strong>
                  <p className="mt-1 text-xs text-muted">{user.username}</p>
                </td>
                <td>
                  <StatusBadge
                    tone={user.status === "active" ? "success" : "neutral"}
                  >
                    {user.status === "active" ? "已启用" : "已停用"}
                  </StatusBadge>
                </td>
                <td>
                  {user.managed_agent_id ? (
                    <Link
                      className="text-primary"
                      to={`/admin/agents/${user.managed_agent_id}?tab=resources`}
                    >
                      管理所属助手
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <Button variant="outline" onClick={() => setEdit(user.id)}>
                    管理
                  </Button>
                </td>
              </tr>
            ))}
          </SimpleTable>
          <Pagination
            page={page}
            size={size}
            total={query.data?.pagination?.total}
            pending={query.isFetching}
            onChange={(next, count) =>
              change({ page: String(next), page_size: String(count) })
            }
          />
        </AsyncBoundary>
      </Panel>
      {edit && (
        <RobotEditor
          key={edit}
          id={edit}
          onClose={() => setEdit(undefined)}
          onSaved={() => void query.refetch()}
        />
      )}
    </div>
  );
}

function RobotEditor({
  id,
  onClose,
  onSaved,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const query = useApiQuery<User>(["robot", id], `/admin/robots/${id}`, {
    enabled: id !== "new",
  });
  return (
    <Drawer
      open
      title={id === "new" ? "创建机器人" : "管理机器人"}
      onClose={onClose}
    >
      {id === "new" ? (
        <RobotProfile onSaved={onSaved} onClose={onClose} />
      ) : (
        <AsyncBoundary
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
        >
          {query.data && (
            <>
              <RobotProfile
                key={query.data.data.version}
                user={query.data.data}
                etag={query.data.etag}
                onSaved={() => {
                  onSaved();
                  void query.refetch();
                }}
                onClose={onClose}
              />
              <RobotResources robotId={id} />
            </>
          )}
        </AsyncBoundary>
      )}
    </Drawer>
  );
}

function RobotProfile({
  user,
  etag,
  onSaved,
  onClose,
}: {
  user?: User;
  etag?: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [username, setUsername] = useState(user?.username ?? "");
  const [name, setName] = useState(user?.display_name ?? "");
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    const parsedName = displayNameSchema.safeParse(name),
      parsedUser = usernameSchema.safeParse(username);
    if (!parsedName.success || !parsedUser.success) {
      setError(new Error("请填写有效的账号和显示名称"));
      return;
    }
    setPending(true);
    try {
      await request(user ? `/admin/users/${user.id}` : "/admin/robots", {
        method: user ? "PATCH" : "POST",
        etag,
        body: user
          ? { display_name: parsedName.data }
          : { username: parsedUser.data, display_name: parsedName.data },
      });
      onSaved();
      if (!user) onClose();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  async function toggle() {
    if (!user) return;
    setPending(true);
    setError(undefined);
    try {
      await request(`/admin/users/${user.id}/status`, {
        method: "PUT",
        etag,
        body: { status: user.status === "active" ? "disabled" : "active" },
      });
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={(e) => void save(e)} className="mb-6 space-y-4">
      <ErrorNotice error={error} />
      <Field label="机器人账号" required>
        <Input
          value={username}
          disabled={Boolean(user)}
          onChange={(e) => setUsername(e.target.value)}
        />
      </Field>
      <Field label="显示名称" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" pending={pending}>
          {user ? "保存名称" : "创建"}
        </Button>
        {user && (
          <Button
            variant="outline"
            pending={pending}
            onClick={() => void toggle()}
          >
            {user.status === "active" ? "停用账号" : "启用账号"}
          </Button>
        )}
      </div>
    </form>
  );
}
