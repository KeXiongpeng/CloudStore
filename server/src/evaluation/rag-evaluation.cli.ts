import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { promisify } from 'util';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { RagEvaluationService, EvaluationPreflightError } from './rag-evaluation.service';
import { RagReportService } from './rag-report.service';
import { EvaluationModule } from './evaluation.module';
import { ragEvaluationSet } from './rag-eval-set';
import type { EvaluationFreeze } from './evaluation.types';

const execFileAsync = promisify(execFile);

export interface EvaluationCliOptions {
  label: string;
  workspaceAId: string;
  workspaceBId: string;
  caseDelayMs: number;
  backendTests: string;
  frontendTests: string;
}

export function parseCliOptions(argv: string[]): EvaluationCliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined)
      throw new Error(`参数不完整：${key ?? 'unknown'}`);
    values.set(key, value);
  }

  const label = values.get('--label') ?? 'rag-evaluation';
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error('--label 只允许小写字母、数字和 -');
  const workspaceAId = values.get('--workspace-a');
  if (!workspaceAId) throw new Error('必须提供 --workspace-a');
  const workspaceBId = values.get('--workspace-b');
  if (!workspaceBId) throw new Error('必须提供 --workspace-b');
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(workspaceAId) || !uuidPattern.test(workspaceBId)) {
    throw new Error('workspace ID 必须是 UUID');
  }

  const caseDelayMs = Number(values.get('--case-delay-ms') ?? 1000);
  if (!Number.isInteger(caseDelayMs) || caseDelayMs < 0)
    throw new Error('--case-delay-ms 必须是不小于 0 的整数');

  return {
    label,
    workspaceAId,
    workspaceBId,
    caseDelayMs,
    backendTests: values.get('--backend-tests') ?? 'not recorded by runner',
    frontendTests: values.get('--frontend-tests') ?? 'not recorded by runner',
  };
}

async function readFreeze(options: EvaluationCliOptions): Promise<EvaluationFreeze> {
  try {
    const root = (await execFileAsync('git', ['rev-parse', '--show-toplevel'])).stdout.trim();
    const [{ stdout: head }, { stdout: status }] = await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root }),
      execFileAsync('git', ['status', '--porcelain=v1'], { cwd: root }),
    ]);
    return {
      gitHead: head.trim(),
      gitDirty: status.trim().length > 0,
      backendTests: options.backendTests,
      frontendTests: options.frontendTests,
    };
  } catch {
    return {
      gitHead: 'unavailable',
      gitDirty: true,
      backendTests: options.backendTests,
      frontendTests: options.frontendTests,
    };
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(EvaluationModule, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });
  try {
    const evaluationService = app.get(RagEvaluationService);
    const reportService = app.get(RagReportService);
    const configService = app.get(ConfigService);

    console.log(`[rag-evaluate] label=${options.label} cases=${ragEvaluationSet.cases.length}`);
    const run = await evaluationService.run(ragEvaluationSet, options);
    console.log(
      `[rag-evaluate] completed=${run.cases.length} failed=${run.cases.filter((item) => !item.metrics.pass).length}`,
    );

    const report = reportService.build({
      label: options.label,
      evaluationSet: ragEvaluationSet,
      run,
      environment: {
        nodeVersion: process.version,
        llmModel: configService.get<string>('llm.model') ?? 'unknown',
        embeddingModel: configService.get<string>('embedding.model') ?? 'unknown',
        llmTemperature: configService.get<number>('llm.temperature'),
        llmMaxTokens: configService.get<number>('llm.maxTokens'),
      },
      freeze: await readFreeze(options),
    });
    const outputDir = resolve(join(process.cwd(), 'evaluation', 'reports'));
    const paths = await reportService.writeReports(report, outputDir);
    await fs.access(paths.jsonPath);
    console.log(`[rag-evaluate] json=${paths.jsonPath}`);
    console.log(`[rag-evaluate] markdown=${paths.markdownPath}`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main()
    .then(() => undefined)
    .catch((error: unknown) => {
      if (error instanceof EvaluationPreflightError) {
        console.error(`[rag-evaluate] ${error.message}`);
      } else {
        console.error(
          `[rag-evaluate] 执行失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      process.exitCode = 1;
    });
}
