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

export const ok = <T>(data: T, message = ''): ApiSuccessResponse<T> => {
  return { success: true, data, message };
};

export const fail = (message: string): ApiErrorResponse => {
  return { success: false, data: null, message };
};

export const formatYuan = (cents: number): string => {
  return (cents / 100).toFixed(2);
};
