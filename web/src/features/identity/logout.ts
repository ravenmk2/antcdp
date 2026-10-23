import { ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { errorMessage, useIdentity } from "./store";

const loggingOut = ref(false);

export function useLogout() {
  const identity = useIdentity();
  const router = useRouter();

  async function logout() {
    if (loggingOut.value) return;
    loggingOut.value = true;
    try {
      await ElMessageBox.confirm(
        "退出后需要重新登录才能继续使用。",
        "确认退出登录",
        {
          confirmButtonText: "退出登录",
          cancelButtonText: "取消",
          closeOnClickModal: false,
        },
      );
      await identity.logout();
      await router.replace("/login");
    } catch (err) {
      if (err !== "cancel" && err !== "close") {
        ElMessage.error(errorMessage(err));
      }
    } finally {
      loggingOut.value = false;
    }
  }

  return { logout, loggingOut };
}
