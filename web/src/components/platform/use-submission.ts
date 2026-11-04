import { ApiError } from "@/lib/api";
import { useOperationToast } from "./operation-toast";
import { useRef, useState } from "react";
import { writeRequiresReview } from "@/lib/write-error";
// Keep the lock synchronous: submitting a form twice can precede the pending render.
export function useSubmission() {
  const notify = useOperationToast();
  const lock = useRef(false),
    [pending, setPending] = useState(false),
    [blocked, setBlocked] = useState(false);
  async function submit(
    action: () => Promise<void>,
    onError: (error: unknown) => void,
  ) {
    if (lock.current || blocked) return;
    lock.current = true;
    setPending(true);
    try {
      await action();
    } catch (error) {
      const review = writeRequiresReview(error);
      setBlocked(review);
      if (review) notify("请核对最新状态后再操作。", "warning");
      else if (!(
        error instanceof ApiError &&
        error.details.some((detail) => detail.field)
      ))
        notify("操作未完成，请查看原因。", "danger");
      onError(error);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return { pending, blocked, submit };
}
