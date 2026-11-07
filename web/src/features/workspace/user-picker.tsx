import { request } from "@/api/client";
import { UserPicker, type SelectableUser } from "@/components/user-picker";
import type { UserOption } from "@/types/collaboration";
export function WorkspaceUserPicker({
  endpoint,
  ...props
}: Omit<
  React.ComponentProps<typeof UserPicker>,
  "loadOptions" | "sourceKey" | "resultLimit"
> & { endpoint: string }) {
  async function loadOptions(
    query: string,
    signal: AbortSignal,
  ): Promise<SelectableUser[]> {
    const response = await request<UserOption[]>(
      `${endpoint}?q=${encodeURIComponent(query)}`,
      { signal },
    );
    return response.data.map((user) => ({
      ...user,
      avatar_url: user.avatar_file_id
        ? `/api/v1/avatars/${user.avatar_file_id}`
        : null,
    }));
  }
  return (
    <UserPicker {...props} sourceKey={endpoint} loadOptions={loadOptions} />
  );
}
