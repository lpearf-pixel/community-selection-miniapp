import type { ReactNode } from 'react';

export type AdminFeatureWorkspaceProps = {
  render: () => ReactNode;
};

export function AdminFeatureWorkspace(props: AdminFeatureWorkspaceProps) {
  return props.render();
}
