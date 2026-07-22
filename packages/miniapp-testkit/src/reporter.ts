import path from 'node:path';

export interface ProgressEvent {
  timestamp: string;
  runId: string;
  event: string;
  details: Record<string, unknown>;
}

export interface JsonLineReporterOptions {
  runId: string;
  outputDir?: string;
  now?: () => Date;
  write?: (line: string) => void;
}

export class JsonLineReporter {
  readonly runId: string;
  readonly outputDir: string;
  private readonly now: () => Date;
  private readonly write: (line: string) => void;
  private readonly history: ProgressEvent[] = [];

  constructor(options: JsonLineReporterOptions) {
    this.runId = options.runId;
    this.outputDir = options.outputDir ?? '/tmp';
    this.now = options.now ?? (() => new Date());
    this.write = options.write ?? ((line) => process.stdout.write(line));
  }

  step(event: string, details: Record<string, unknown> = {}): ProgressEvent {
    const entry: ProgressEvent = {
      timestamp: this.now().toISOString(),
      runId: this.runId,
      event,
      details,
    };
    this.history.push(entry);
    this.write(`${JSON.stringify(entry)}\n`);
    return entry;
  }

  events(): readonly ProgressEvent[] {
    return [...this.history];
  }

  artifactPath(kind: string, extension: string): string {
    return path.join(this.outputDir, `miniapp-e2e-${this.runId}-${kind}.${extension}`);
  }
}
