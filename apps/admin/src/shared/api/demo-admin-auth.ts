export type DemoAdminAuthInput = {
  dev: boolean;
  token?: string;
};

export function demoAdminAuthHeaders(
  input: DemoAdminAuthInput,
): Record<string, string> {
  const token = input.token?.trim() ?? '';
  if (!input.dev || !token) return {};
  return { 'x-admin-token': token };
}
