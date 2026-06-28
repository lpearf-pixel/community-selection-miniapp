export type ApiResponse<T> =
  | { success: true; data: T; message: string }
  | { success: false; data: null; message: string };

export const ok = <T>(data: T, message = ''): ApiResponse<T> => ({
  success: true,
  data,
  message
});

export const fail = (message: string): ApiResponse<never> => ({
  success: false,
  data: null,
  message
});

export interface HealthData {
  status: 'ok';
  service: string;
}
