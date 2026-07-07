declare module "@community-selection/shared" {
  export type ApiSuccessResponse<T> = {
    success: true;
    data: T;
    message: string;
  };

  export type ApiErrorResponse = {
    success: false;
    data: null;
    message: string;
  };

  export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

  export function ok<T>(data: T, message?: string): ApiSuccessResponse<T>;

  export function fail(message: string): ApiErrorResponse;

  export function formatYuan(cents: number): string;
}
