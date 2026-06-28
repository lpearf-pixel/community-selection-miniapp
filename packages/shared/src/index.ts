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

export function ok<T>(data: T, message = ''): ApiSuccessResponse<T> {
  return { success: true, data, message };
}

export function fail(message: string): ApiErrorResponse {
  return { success: false, data: null, message };
}
