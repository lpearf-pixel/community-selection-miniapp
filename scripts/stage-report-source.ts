import {
  getStageDefinition,
  type ReportContract,
} from './stage-registry.ts';
import { installL46ReportEvidenceHook } from './l46-report-evidence-hook.ts';

installL46ReportEvidenceHook();

export type LegacyReportSource = {
  businessBaseBranch?: string;
  businessBaseCommit?: string;
};

export type ResolvedReportSource =
  | {
      sourceMode: 'git_diff';
      businessBaseBranch: string;
      businessBaseCommit: string;
    }
  | {
      sourceMode: 'legacy_manifest';
      businessBaseBranch?: string;
      businessBaseCommit?: string;
    };

function optionalNonBlank(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) throw new Error(`Legacy report source ${field} must not be blank`);
  return normalized;
}

function resolveRegistryContract(contract: ReportContract): ResolvedReportSource {
  if (contract.sourceMode !== 'git_diff' || !contract.businessBaseBranch || !contract.businessBaseCommit) {
    throw new Error('Registered report contract must define git_diff branch and commit');
  }
  return {
    sourceMode: 'git_diff',
    businessBaseBranch: contract.businessBaseBranch,
    businessBaseCommit: contract.businessBaseCommit,
  };
}

export function resolveReportSource(stageId: string, legacySource?: LegacyReportSource): ResolvedReportSource {
  const definition = getStageDefinition(stageId);
  if (!definition) throw new Error(`Stage ${stageId} is not registered`);
  if (definition.reportContract) return resolveRegistryContract(definition.reportContract);
  if (legacySource !== undefined) {
    return {
      sourceMode: 'legacy_manifest',
      businessBaseBranch: optionalNonBlank(legacySource.businessBaseBranch, 'businessBaseBranch'),
      businessBaseCommit: optionalNonBlank(legacySource.businessBaseCommit, 'businessBaseCommit'),
    };
  }
  throw new Error(`Stage ${stageId} has no report source contract or legacy manifest`);
}
