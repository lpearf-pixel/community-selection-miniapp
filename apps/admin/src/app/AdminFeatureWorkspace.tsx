import type { ReactNode } from 'react';

export type AdminFeatureWorkspaceProps = {
  render: () => ReactNode;
};

export function AdminFeatureWorkspace(props: AdminFeatureWorkspaceProps) {
  const testWindow =
    typeof window === 'undefined'
      ? undefined
      : (window as Window & { __ADMIN_E2E_FORCE_RENDER_ERROR__?: boolean });
  if (import.meta.env.DEV && testWindow?.__ADMIN_E2E_FORCE_RENDER_ERROR__) {
    throw new Error('forced Admin E2E render failure');
  }
  return props.render();
}
