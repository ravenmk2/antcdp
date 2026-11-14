import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import {
  ApiError,
  request,
  type ApiResponse,
  type RequestOptions,
} from "@/api/client";
import type { ZodType } from "zod";

export function useApiQuery<T>(
  key: QueryKey,
  path: string,
  options: {
    enabled?: boolean;
    schema?: ZodType<T>;
    staleTime?: number;
    retry?: UseQueryOptions<ApiResponse<T>, ApiError>["retry"];
    placeholderData?: UseQueryOptions<
      ApiResponse<T>,
      ApiError
    >["placeholderData"];
  } = {},
) {
  return useQuery<ApiResponse<T>, ApiError>({
    queryKey: key,
    queryFn: ({ signal }) => request<T>(path, { signal }, options.schema),
    enabled: options.enabled,
    staleTime: options.staleTime ?? 15_000,
    retry:
      options.retry ??
      ((count, error) =>
        count < 1 && (error.status === 0 || error.status >= 500)),
    placeholderData: options.placeholderData,
  });
}

export function useApiMutation<T, V>(
  options?: Omit<UseMutationOptions<T, ApiError, V>, "mutationFn"> & {
    invalidate?: QueryKey[];
  },
) {
  const queryClient = useQueryClient();
  const { invalidate, ...mutationOptions } = options ?? {};
  return useMutation({
    retry: false,
    ...mutationOptions,
    onSuccess: async (data, variables, context, mutation) => {
      if (invalidate) {
        await Promise.all(
          invalidate.map((key) =>
            queryClient.invalidateQueries({ queryKey: key }),
          ),
        );
      }
      await mutationOptions?.onSuccess?.(data, variables, context, mutation);
    },
  });
}

export async function write<T>(
  path: string,
  options: RequestOptions,
  schema?: ZodType<T>,
) {
  return request<T>(path, options, schema);
}
