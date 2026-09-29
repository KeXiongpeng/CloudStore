import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { chunkMarkdown } from '../documents/markdown-chunker';
import type { RagEvaluationSet } from './evaluation.types';

const fact = (point: string, anchors: string[]) => ({ point, anchors });
export const ragEvaluationSet: RagEvaluationSet = {
  version: 'v1',
  title: 'D5 RAG baseline evaluation set',
  expectedWorkspaceADocTitles: [
    '01-hnsw.md',
    '02-pgvector.md',
    '03-cosine-distance.md',
    '04-embedding.md',
    '05-upload-index.md',
    '06-markdown-chunking.md',
    '07-sse-chat.md',
    '08-stategraph-rag.md',
  ],
  workspaceBMustBeEmpty: true,
  cases: [
    {
      id: 'fact-001',
      category: 'single-source-fact',
      workspace: 'A',
      question: 'HNSW 的 M 参数是什么？',
      limit: 5,
      expected: {
        behavior: 'answer',
        mustMention: [fact('M 控制每个节点最大连接或出边数量', ['M', '最大', '连接', '出边'])],
        expectedSourceHeadingPaths: [['核心参数 M 和 efConstruction']],
        minSources: 1,
        maxSources: 5,
        requireCitation: true,
      },
    },
    {
      id: 'fact-002',
      category: 'single-source-fact',
      workspace: 'A',
      question: 'HNSW 的 efSearch 在查询时起什么作用？',
      limit: 5,
      expected: {
        behavior: 'answer',
        mustMention: [
          fact('efSearch 控制查询时候选队列大小，影响召回和耗时', [
            'efSearch',
            '候选',
            '队列',
            '召回',
            '耗时',
          ]),
        ],
        expectedSourceHeadingPaths: [['查询参数 efSearch']],
        minSources: 1,
        maxSources: 5,
        requireCitation: true,
      },
    },
    {
      id: 'fact-003',
      category: 'single-source-fact',
      workspace: 'A',
      question: 'pgvector 里 1024 维向量应该用什么字段类型存储？',
      limit: 5,
      expected: {
        behavior: 'answer',
        mustMention: [fact('使用 vector(1024) 字段类型', ['vector', '1024'])],
        expectedSourceHeadingPaths: [['vector 字段']],
        minSources: 1,
        maxSources: 5,
        requireCitation: true,
      },
    },
    {
      id: 'fact-004',
      category: 'single-source-fact',
      workspace: 'A',
      question: '余弦距离是怎么计算的？',
      limit: 5,
      expected: {
        behavior: 'answer',
        mustMention: [
          fact('余弦距离基于向量夹角余弦，关注方向而不是长度', ['夹角', '余弦', '方向']),
        ],
        expectedSourceHeadingPaths: [['计算公式']],
        minSources: 1,
        maxSources: 5,
        requireCitation: true,
      },
    },
    {
      id: 'fact-005',
      category: 'single-source-fact',
      workspace: 'A',
      question: '上传后的知识库文件有哪几种索引状态？',
      limit: 5,
      expected: {
        behavior: 'answer',
        mustMention: [
          fact('状态包括 pending、processing、indexed、failed', [
            'pending',
            'processing',
            'indexed',
            'failed',
          ]),
        ],
        expectedSourceHeadingPaths: [['索引状态']],
        minSources: 1,
        maxSources: 5,
        requireCitation: true,
      },
    },
    {
      id: 'fact-006',
      category: 'single-source-fact',
      workspace: 'A',
      question: '聊天接口正常完成后会发送哪些 SSE 事件？',
      limit: 5,
      expected: {
        behavior: 'answer',
        mustMention: [
          fact('正常事件顺序是 sources、多个 delta、done', ['sources', 'delta', 'done']),
        ],
        expectedSourceHeadingPaths: [['正常顺序']],
        minSources: 1,
        maxSources: 5,
        requireCitation: true,
      },
    },
    {
      id: 'multi-001',
      category: 'multi-source',
      workspace: 'A',
      question: 'pgvector 如何配合 HNSW 做向量检索？',
      limit: 5,
      expected: {
        behavior: 'answer',
        mustMention: [
          fact('pgvector 存储向量并支持余弦距离检索', ['pgvector', 'vector', '余弦']),
          fact('HNSW 提供图索引和查询参数', ['HNSW', '索引']),
        ],
        expectedSourceHeadingPaths: [['vector 字段'], ['核心参数 M 和 efConstruction']],
        minSources: 2,
        maxSources: 5,
        requireCitation: true,
      },
    },
    {
      id: 'multi-002',
      category: 'multi-source',
      workspace: 'A',
      question: '为什么文本要先转成 Embedding，再用余弦距离判断相似度？',
      limit: 5,
      expected: {
        behavior: 'answer',
        mustMention: [
          fact('Embedding 把文本映射成语义向量', ['Embedding', '语义', '向量']),
          fact('余弦距离比较向量方向相似度', ['余弦', '方向', '相似']),
        ],
        expectedSourceHeadingPaths: [['什么是 Embedding'], ['为什么适合语义检索']],
        minSources: 2,
        maxSources: 5,
        requireCitation: true,
      },
    },
    {
      id: 'multi-003',
      category: 'multi-source',
      workspace: 'A',
      question: '上传 Markdown 后，系统会怎样切块并进入异步索引？',
      limit: 5,
      expected: {
        behavior: 'answer',
        mustMention: [
          fact('Markdown 按标题边界切块并保留 headingPath', ['标题', 'headingPath']),
          fact('索引通过异步队列执行并更新状态', ['队列', '异步', '状态']),
        ],
        expectedSourceHeadingPaths: [['Markdown 标题切块'], ['索引状态']],
        minSources: 2,
        maxSources: 5,
        requireCitation: true,
      },
    },
    {
      id: 'multi-004',
      category: 'multi-source',
      workspace: 'A',
      question: 'StateGraph RAG 会经过哪些节点？前端按什么顺序收到结果？',
      limit: 5,
      expected: {
        behavior: 'answer',
        mustMention: [
          fact('RAG 图包含 retrieve、judge、rewrite、generate、fallback 路径', [
            'retrieve',
            'judge',
            'generate',
            'fallback',
          ]),
          fact('前端先收到 sources，再收到 delta，最后收到 done', ['sources', 'delta', 'done']),
        ],
        expectedSourceHeadingPaths: [['图节点'], ['正常顺序']],
        minSources: 2,
        maxSources: 5,
        requireCitation: true,
      },
    },
    {
      id: 'colloquial-001',
      category: 'colloquial',
      workspace: 'A',
      question: '建那种图索引的时候，每个点最多能连多少条线来着？',
      limit: 5,
      expected: {
        behavior: 'answer',
        mustMention: [fact('HNSW 的 M 控制每个节点最大连接或出边数量', ['M', '最大', '连接'])],
        expectedSourceHeadingPaths: [['核心参数 M 和 efConstruction']],
        minSources: 1,
        maxSources: 5,
        requireCitation: true,
      },
    },
    {
      id: 'colloquial-002',
      category: 'colloquial',
      workspace: 'A',
      question: '想让查资料时多捞一点候选再精挑，应该调哪个参数？',
      limit: 5,
      expected: {
        behavior: 'answer',
        mustMention: [fact('应调整 HNSW 的 efSearch 查询候选参数', ['efSearch'])],
        expectedSourceHeadingPaths: [['查询参数 efSearch']],
        minSources: 1,
        maxSources: 5,
        requireCitation: true,
      },
    },
    {
      id: 'colloquial-003',
      category: 'colloquial',
      workspace: 'A',
      question: '上传完怎么还不能问？失败了要怎么办？',
      limit: 5,
      expected: {
        behavior: 'answer',
        mustMention: [
          fact('文件要等待异步索引完成，失败后可重新索引', ['异步', '索引', '失败', 'reindex']),
        ],
        expectedSourceHeadingPaths: [['索引状态'], ['重新索引']],
        minSources: 1,
        maxSources: 5,
        requireCitation: true,
      },
    },
    {
      id: 'colloquial-004',
      category: 'colloquial',
      workspace: 'A',
      question: '页面上回答一个字一个字蹦出来，是怎么实现的？',
      limit: 5,
      expected: {
        behavior: 'answer',
        mustMention: [fact('后端通过 SSE delta 增量推送文本', ['SSE', 'delta'])],
        expectedSourceHeadingPaths: [['事件类型']],
        minSources: 1,
        maxSources: 5,
        requireCitation: true,
      },
    },
    {
      id: 'irrelevant-001',
      category: 'irrelevant',
      workspace: 'A',
      question: 'HNSW 图谱附近有什么好吃的餐厅？',
      limit: 5,
      expected: {
        behavior: 'fallback',
        expectedSourceHeadingPaths: [],
        minSources: 0,
        maxSources: 5,
        requireCitation: false,
      },
    },
    {
      id: 'irrelevant-002',
      category: 'irrelevant',
      workspace: 'A',
      question: 'pgvector 能帮我订明天去厦门的机票吗？',
      limit: 5,
      expected: {
        behavior: 'fallback',
        expectedSourceHeadingPaths: [],
        minSources: 0,
        maxSources: 5,
        requireCitation: false,
      },
    },
    {
      id: 'irrelevant-003',
      category: 'irrelevant',
      workspace: 'A',
      question: 'ef_search 听起来像哪首歌的歌名？',
      limit: 5,
      expected: {
        behavior: 'fallback',
        expectedSourceHeadingPaths: [],
        minSources: 0,
        maxSources: 5,
        requireCitation: false,
      },
    },
    {
      id: 'irrelevant-004',
      category: 'irrelevant',
      workspace: 'A',
      question: '余弦距离能不能预测下周股市涨跌？',
      limit: 5,
      expected: {
        behavior: 'fallback',
        expectedSourceHeadingPaths: [],
        minSources: 0,
        maxSources: 5,
        requireCitation: false,
      },
    },
    {
      id: 'isolation-001',
      category: 'workspace-isolation',
      workspace: 'B-empty',
      question: 'HNSW 的 M 参数是什么？',
      limit: 5,
      expected: {
        behavior: 'fallback',
        expectedSourceHeadingPaths: [],
        minSources: 0,
        maxSources: 0,
        requireCitation: false,
      },
    },
    {
      id: 'isolation-002',
      category: 'workspace-isolation',
      workspace: 'B-empty',
      question: '上传后的知识库文件有哪些索引状态？',
      limit: 5,
      expected: {
        behavior: 'fallback',
        expectedSourceHeadingPaths: [],
        minSources: 0,
        maxSources: 0,
        requireCitation: false,
      },
    },
  ],
};

/**
 * DocumentIndexService 的 contentHash 是“所有 chunk.content 以空行 join 后”的 SHA256。
 * 这里用同一算法从冻结 Markdown 推导期望值，避免把脆弱的手工哈希写死在评估集里。
 */
export function getExpectedWorkspaceADocumentHashes(): Record<string, string> {
  return Object.fromEntries(
    ragEvaluationSet.expectedWorkspaceADocTitles.map((title) => {
      const markdown = readFileSync(
        join(__dirname, '..', '..', 'evaluation', 'corpus', title),
        'utf8',
      )
        .replace(/^\uFEFF/, '')
        .trim();
      const fullText = chunkMarkdown(markdown)
        .map((chunk) => chunk.content)
        .join('\n\n');
      return [title, createHash('sha256').update(fullText).digest('hex')];
    }),
  );
}
