import { createApiClient } from "@/shared/api";
export { ApiError } from "@/shared/api";
export type { RequestOptions, ApiResponse } from "@/shared/api";
export const { api, request, resetCSRF, onAuthFailure } = createApiClient();
export { errorMessage } from "@/shared/validation";
