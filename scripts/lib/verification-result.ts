export type VerificationIssueKind =
  | 'stage'
  | 'security'
  | 'new-type-error'
  | 'baseline-type-error'
  | 'environment';

export type VerificationIssue = {
  kind: VerificationIssueKind;
  code: string;
  file?: string;
  message: string;
  blocking: boolean;
};

export type VerificationResult = {
  stageErrors: VerificationIssue[];
  securityErrors: VerificationIssue[];
  newTypeErrors: VerificationIssue[];
  baselineTypeErrors: VerificationIssue[];
  environmentErrors: VerificationIssue[];
};

export function emptyVerificationResult(): VerificationResult {
  return {
    stageErrors: [],
    securityErrors: [],
    newTypeErrors: [],
    baselineTypeErrors: [],
    environmentErrors: []
  };
}

export function isVerificationBlocking(result: VerificationResult, options: { requireCleanBaseline?: boolean } = {}): boolean {
  return result.stageErrors.length > 0
    || result.securityErrors.length > 0
    || result.newTypeErrors.length > 0
    || result.environmentErrors.length > 0
    || (options.requireCleanBaseline === true && result.baselineTypeErrors.length > 0);
}
