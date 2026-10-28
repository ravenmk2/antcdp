import { onMounted, onUnmounted } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { ElMessageBox } from "element-plus";

export function useUnsaved(pending: () => boolean, busy: () => boolean) {
  const guard = async () => {
    if (busy()) return false;
    if (!pending()) return true;
    try {
      await ElMessageBox.confirm("离开将丢弃未保存的修改。", "未保存的修改", {
        confirmButtonText: "丢弃并离开",
        cancelButtonText: "继续编辑",
      });
      return true;
    } catch {
      return false;
    }
  };
  onBeforeRouteLeave(guard);
  onBeforeRouteUpdate(guard);
  const unload = (event: BeforeUnloadEvent) => {
    if (pending() || busy()) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  onMounted(() => window.addEventListener("beforeunload", unload));
  onUnmounted(() => window.removeEventListener("beforeunload", unload));
}
