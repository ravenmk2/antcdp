import { ApiError } from "./api";
export function writeOutcomeUnknown(error: unknown) {
  return (
    error instanceof ApiError &&
    [
      "NETWORK_ERROR",
      "HTTP_ERROR",
      "INVALID_RESPONSE",
      "INTERNAL_ERROR",
    ].includes(error.code)
  );
}
export function writeRequiresReview(error: unknown) {
  return (
    writeOutcomeUnknown(error) ||
    (error instanceof ApiError &&
      [
        "VERSION_CONFLICT",
        "COLLECTION_VERSION_CONFLICT",
        "PRECONDITION_FAILED",
      ].includes(error.code))
  );
}
export const writeReviewMessage =
  "版本已变化或提交结果未确认。草稿已保留，请核实最新记录后再操作。";
