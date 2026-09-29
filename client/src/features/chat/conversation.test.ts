import { describe, expect, it } from 'vitest';
import { createInitialConversation, conversationReducer, findRetryQuestion } from './conversation';
import type { ChatConversationState } from './conversation';
import type { ChatMessage, ChatSource } from './types';

const source: ChatSource = {
  chunkId: 'chunk-1',
  documentId: 'doc-1',
  title: 'D3 文档',
  sourcePath: 'uploads/d3.md',
  headingPath: ['D3', '检索'],
  chunkIndex: 2,
  content: 'pgvector 用于向量检索。',
  similarity: 0.91,
};

function askStart(state: ChatConversationState = createInitialConversation()) {
  return conversationReducer(state, {
    type: 'askStart',
    userMessage: { id: 'user-1', role: 'user', content: '文本向量化' },
    assistantMessage: {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      status: 'searching',
      sources: [],
    },
  });
}

describe('conversationReducer', () => {
  it('askStart 追加用户气泡和助手检索中气泡', () => {
    const state = askStart();

    expect(state.activeAssistantId).toBe('assistant-1');
    expect(state.messages).toEqual([
      { id: 'user-1', role: 'user', content: '文本向量化' },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        status: 'searching',
        sources: [],
      },
    ]);
  });

  it('sources 让当前助手气泡进入生成中并保存引用', () => {
    let state = askStart();
    state = conversationReducer(state, {
      type: 'sources',
      messageId: 'assistant-1',
      sources: [source],
    });

    expect(state.messages[1]).toMatchObject({
      id: 'assistant-1',
      status: 'generating',
      sources: [source],
    });
  });

  it('多个 delta 按顺序追加到当前助手气泡', () => {
    let state = askStart();
    state = conversationReducer(state, {
      type: 'sources',
      messageId: 'assistant-1',
      sources: [],
    });
    state = conversationReducer(state, {
      type: 'delta',
      messageId: 'assistant-1',
      content: '文本',
    });
    state = conversationReducer(state, {
      type: 'delta',
      messageId: 'assistant-1',
      content: '变向量',
    });

    expect(state.messages[1]).toMatchObject({
      status: 'generating',
      content: '文本变向量',
    });
  });

  it('done 结束当前回答并清除 activeAssistantId', () => {
    let state = askStart();
    state = conversationReducer(state, { type: 'done', messageId: 'assistant-1' });

    expect(state.messages[1]).toMatchObject({ status: 'done', content: '' });
    expect(state.activeAssistantId).toBeNull();
  });

  it('error 保存错误信息并结束当前请求', () => {
    let state = askStart();
    state = conversationReducer(state, {
      type: 'error',
      messageId: 'assistant-1',
      message: '模型服务鉴权失败',
    });

    expect(state.messages[1]).toMatchObject({
      status: 'error',
      errorMessage: '模型服务鉴权失败',
    });
    expect(state.activeAssistantId).toBeNull();
  });

  it('stop 把进行中的气泡标记为已停止', () => {
    let state = askStart();
    state = conversationReducer(state, { type: 'stop', messageId: 'assistant-1' });

    expect(state.messages[1]).toMatchObject({ status: 'stopped' });
    expect(state.activeAssistantId).toBeNull();
  });

  it('忽略不属于当前消息的事件，避免旧请求污染新回答', () => {
    let state = askStart();
    state = conversationReducer(state, { type: 'delta', messageId: 'old-message', content: '旧' });

    expect(state.messages[1]).toMatchObject({ content: '', status: 'searching' });
  });
});

describe('conversation session actions', () => {
  it('reset 清空当前会话', () => {
    let state = askStart();
    state = conversationReducer(state, { type: 'reset' });

    expect(state).toEqual({ messages: [], activeAssistantId: null });
  });

  it('replace 恢复持久化消息并清空活动请求', () => {
    const restored: ChatMessage[] = [
      { id: 'u1', role: 'user', content: '旧问题' },
      {
        id: 'a1',
        role: 'assistant',
        content: '旧回答',
        status: 'stopped',
        sources: [source],
      },
    ];
    const state = conversationReducer(createInitialConversation(), {
      type: 'replace',
      messages: restored,
    });

    expect(state.messages).toEqual(restored);
    expect(state.activeAssistantId).toBeNull();
  });
});

describe('findRetryQuestion', () => {
  it('根据失败助手气泡找到前面最近的用户问题', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: '第一个问题' },
      { id: 'a1', role: 'assistant', content: '', status: 'stopped', retryQuestion: '第一个问题' },
      { id: 'u2', role: 'user', content: '文本向量化' },
      { id: 'a2', role: 'assistant', content: '', status: 'error', retryQuestion: '文本向量化' },
    ];

    expect(findRetryQuestion(messages, messages[3]!)).toBe('文本向量化');
  });

  it('优先使用助手气泡保存的原始问题', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: '用户可见问题' },
      {
        id: 'a1',
        role: 'assistant',
        content: '半截回答',
        status: 'error',
        retryQuestion: '真正的原始问题',
      },
    ];

    expect(findRetryQuestion(messages, messages[1]!)).toBe('真正的原始问题');
  });
});
