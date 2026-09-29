import { Test } from '@nestjs/testing';
import { RagAnswerJudgeService } from './rag-answer-judge.service';
import { RagEvaluationService } from './rag-evaluation.service';
import { RagReportService } from './rag-report.service';
import { EvaluationModule } from './evaluation.module';

describe('EvaluationModule', () => {
  it('compiles the full evaluation dependency graph', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EvaluationModule],
    }).compile();

    expect(moduleRef.get(RagEvaluationService)).toBeDefined();
    expect(moduleRef.get(RagAnswerJudgeService)).toBeDefined();
    expect(moduleRef.get(RagReportService)).toBeDefined();
  });
});
