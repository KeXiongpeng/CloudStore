import { ragEvaluationSet } from './rag-eval-set';

describe('20 case RAG evaluation set v1', () => {
  it('contains exactly 20 unique cases with the approved category distribution', () => {
    expect(ragEvaluationSet.version).toBe('v1');
    expect(ragEvaluationSet.cases).toHaveLength(20);

    const countBy = (category: string) =>
      ragEvaluationSet.cases.filter((item) => item.category === category).length;
    expect(countBy('single-source-fact')).toBe(6);
    expect(countBy('multi-source')).toBe(4);
    expect(countBy('colloquial')).toBe(4);
    expect(countBy('irrelevant')).toBe(4);
    expect(countBy('workspace-isolation')).toBe(2);

    expect(new Set(ragEvaluationSet.cases.map((item) => item.id)).size).toBe(20);
  });

  it('always defines behavior, citation rule, and source bounds', () => {
    for (const item of ragEvaluationSet.cases) {
      expect(['answer', 'fallback']).toContain(item.expected.behavior);
      expect(typeof item.expected.requireCitation).toBe('boolean');
      expect(Array.isArray(item.expected.expectedSourceHeadingPaths)).toBe(true);

      if (item.expected.behavior === 'answer') {
        expect(item.expected.expectedSourceHeadingPaths.length).toBeGreaterThan(0);
        expect(item.expected.minSources ?? 0).toBeGreaterThan(0);
        expect(item.expected.requireCitation).toBe(true);
        expect(item.expected.mustMention?.length ?? 0).toBeGreaterThan(0);
      }

      if (item.expected.behavior === 'fallback') {
        expect(item.expected.expectedSourceHeadingPaths).toHaveLength(0);
        expect(item.expected.requireCitation).toBe(false);
      }
    }
  });

  it('uses the requested retrieval limit as maxSources for every answer case', () => {
    const answerCases = ragEvaluationSet.cases.filter(
      (item) => item.expected.behavior === 'answer',
    );
    expect(answerCases.length).toBe(14);
    expect(answerCases.every((item) => item.expected.maxSources === item.limit)).toBe(true);
  });
  it('uses workspace B only for two empty-workspace isolation cases', () => {
    const isolationCases = ragEvaluationSet.cases.filter((item) => item.workspace === 'B-empty');
    expect(isolationCases).toHaveLength(2);
    expect(isolationCases.every((item) => item.category === 'workspace-isolation')).toBe(true);
    expect(isolationCases.every((item) => item.expected.behavior === 'fallback')).toBe(true);
    expect(isolationCases.every((item) => item.expected.maxSources === 0)).toBe(true);
  });

  it('requires the eight frozen corpus documents', () => {
    expect(ragEvaluationSet.expectedWorkspaceADocTitles).toHaveLength(8);
    expect(ragEvaluationSet.workspaceBMustBeEmpty).toBe(true);
  });
});
