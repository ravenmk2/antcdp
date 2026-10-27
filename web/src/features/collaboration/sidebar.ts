import { defineStore } from "pinia";
import { ref } from "vue";
import { api, request } from "../../shared/api";
import type { Kind, Resource } from "./model";
import { useIdentity } from "../identity/store";
export interface Group {
  items: Resource[];
  etag: string;
}
export const useShortcuts = defineStore("collaboration-shortcuts", () => {
  const owner = ref("");
  const groups = ref<Record<Kind, Group>>({
    projects: { items: [], etag: "" },
    teams: { items: [], etag: "" },
  });
  async function refresh() {
    const id = useIdentity().user?.id || "";
    if (owner.value !== id) {
      groups.value = {
        projects: { items: [], etag: "" },
        teams: { items: [], etag: "" },
      };
      owner.value = id;
    }
    const result = await api<Record<Kind, Group>>("/me/sidebar-shortcuts");
    if (useIdentity().user?.id === id) groups.value = result;
  }
  async function save(kind: Kind, ids: string[], etag: string) {
    groups.value[kind] = (
      await request<Group>(`/me/sidebar-shortcuts/${kind}`, {
        method: "PUT",
        body: { ids },
        etag,
      })
    ).data;
  }
  return { groups, refresh, save };
});
