'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useWorkspaceStore } from '@/features/workspace/store';
import { askKnowledgeBase } from './api';
import {
  conversationReducer,
  createInitialConversation,
  findRetryQuestion,
  type ChatMessageStatus,
} from './conversation';
import {
  clearActiveChatSession,
  loadChatSessions,
  saveChatSessions,
  upsertActiveChatSession,
  type ChatSession,
} from './session-storage';
import type { ChatMessage } from './types';

const STATUS_TEXT: Record<ChatMessageStatus, string> = {
  searching: '正在向量化并检索知识库...',
  generating: '正在生成回答...',
  done: '回答完成',
  error: '回答失败',
  stopped: '已停止生成',
};

let idSeed = 0;

function createId(prefix: 'user' | 'assistant' | 'session') {
  idSeed += 1;
  return `${prefix}-${Date.now()}-${idSeed}`;
}

function ThinkingDots({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
      <span>{label}</span>
      <span className="flex items-center gap-1" aria-hidden>
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="size-1.5 animate-bounce rounded-full bg-blue-500"
            style={{ animationDelay: `${index * 0.15}s` }}
          />
        ))}
      </span>
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
      AI
    </div>
  );
}

export default function ChatPanel() {
  const { user, loading: authLoading } = useAuth();
  const workspace = useWorkspaceStore((state) => state.currentWorkspace);

  const [conversation, dispatch] = useReducer(
    conversationReducer,
    undefined,
    createInitialConversation,
  );
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [question, setQuestion] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);

  const { messages, activeAssistantId } = conversation;
  const activeAssistant = messages.find(
    (message) => message.id === activeAssistantId && message.role === 'assistant',
  );
  const isBusy =
    activeAssistant?.status === 'searching' || activeAssistant?.status === 'generating';

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [messages]);

  // 用户变化时加载该浏览器账号下的本地会话；历史里的进行中请求会被标记为停止。
  useEffect(() => {
    if (authLoading || !user?.id) return;
    const storage = loadChatSessions(user.id);
    const activeId = storage.activeSessionId ?? createId('session');
    setSessions(storage.sessions);
    setActiveSessionId(activeId);

    const active = storage.sessions.find((session) => session.id === activeId);
    dispatch({ type: 'replace', messages: active?.messages ?? [] });
    setSessionsLoaded(true);
  }, [authLoading, user?.id]);

  // 气泡变化时持久化当前会话。仅保存非空会话，避免存一堆空白记录。
  useEffect(() => {
    if (!sessionsLoaded || !user?.id || !activeSessionId) return;
    const base = loadChatSessions(user.id);
    const next = upsertActiveChatSession(base, conversation, activeSessionId);
    setSessions(next.sessions);
    saveChatSessions(user.id, next);
  }, [activeSessionId, conversation, sessionsLoaded, user?.id]);

  const ask = useCallback(
    async (nextQuestion: string) => {
      const normalizedQuestion = nextQuestion.trim();
      if (!normalizedQuestion || !workspace?.id || activeAssistantId) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const userMessage: ChatMessage = {
        id: createId('user'),
        role: 'user',
        content: normalizedQuestion,
      };
      const assistantMessage: ChatMessage = {
        id: createId('assistant'),
        role: 'assistant',
        content: '',
        status: 'searching',
        sources: [],
        retryQuestion: normalizedQuestion,
      };
      dispatch({ type: 'askStart', userMessage, assistantMessage });
      setQuestion('');

      const assistantId = assistantMessage.id;
      let receivedDone = false;
      let receivedError = false;

      try {
        await askKnowledgeBase({
          workspaceId: workspace.id,
          question: normalizedQuestion,
          limit: 5,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'sources') {
              dispatch({ type: 'sources', messageId: assistantId, sources: event.sources });
              return;
            }
            if (event.type === 'delta') {
              dispatch({ type: 'delta', messageId: assistantId, content: event.content });
              return;
            }
            if (event.type === 'done') {
              receivedDone = true;
              dispatch({ type: 'done', messageId: assistantId });
              return;
            }
            if (event.type === 'error') {
              receivedError = true;
              dispatch({ type: 'error', messageId: assistantId, message: event.message });
            }
          },
        });

        if (!receivedDone && !receivedError) {
          dispatch({ type: 'done', messageId: assistantId });
        }
      } catch (requestError) {
        if (controller.signal.aborted) {
          dispatch({ type: 'stop', messageId: assistantId });
          return;
        }
        dispatch({
          type: 'error',
          messageId: assistantId,
          message: requestError instanceof Error ? requestError.message : '问答服务暂时不可用',
        });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [activeAssistantId, workspace?.id],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const startNewSession = useCallback(() => {
    if (isBusy || !user?.id || !activeSessionId) return;
    let storage = upsertActiveChatSession(loadChatSessions(user.id), conversation, activeSessionId);
    const sessionId = createId('session');
    storage = { ...storage, activeSessionId: sessionId };
    setSessions(storage.sessions);
    setActiveSessionId(sessionId);
    saveChatSessions(user.id, storage);
    dispatch({ type: 'reset' });
  }, [activeAssistantId, activeSessionId, conversation, isBusy, user?.id]);

  const clearActiveSession = useCallback(() => {
    if (isBusy || !user?.id || !activeSessionId) return;
    const storage = clearActiveChatSession(loadChatSessions(user.id), activeSessionId);
    const sessionId = createId('session');
    const next = { ...storage, activeSessionId: sessionId };
    setSessions(next.sessions);
    setActiveSessionId(sessionId);
    saveChatSessions(user.id, next);
    dispatch({ type: 'reset' });
  }, [activeAssistantId, activeSessionId, isBusy, user?.id]);

  const switchSession = useCallback(
    (sessionId: string) => {
      if (isBusy || sessionId === activeSessionId) return;
      let storage = upsertActiveChatSession(
        loadChatSessions(user?.id ?? ''),
        conversation,
        activeSessionId,
      );
      storage = { ...storage, activeSessionId: sessionId };
      setSessions(storage.sessions);
      setActiveSessionId(sessionId);
      const target = storage.sessions.find((session) => session.id === sessionId);
      dispatch({ type: 'replace', messages: target?.messages ?? [] });
      if (user?.id) saveChatSessions(user.id, storage);
    },
    [activeAssistantId, activeSessionId, conversation, isBusy, user?.id],
  );

  const submit = () => void ask(question);
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const statusText = latestAssistant?.status
    ? STATUS_TEXT[latestAssistant.status]
    : '输入问题开始检索问答';

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col">
      <div className="border-b border-gray-200 pb-4 dark:border-gray-700">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">知识库问答</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              回答来自当前工作区已成功索引的文件。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={activeSessionId}
              onChange={(event) => switchSession(event.target.value)}
              disabled={isBusy}
              className="max-w-[180px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
              aria-label="选择聊天会话"
            >
              {activeSessionId && !sessions.some((session) => session.id === activeSessionId) && (
                <option value={activeSessionId}>当前会话</option>
              )}
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={startNewSession}
              disabled={isBusy}
              className="rounded-xl border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              新会话
            </button>
            <button
              type="button"
              onClick={clearActiveSession}
              disabled={isBusy}
              className="rounded-xl border border-red-200 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
            >
              清空
            </button>
          </div>
        </div>
      </div>

      {!workspace && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          请先选择工作区后再提问。
        </div>
      )}

      <div
        ref={outputRef}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto py-5"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            上传到当前工作区的 Markdown、txt 和 PDF 文件会在索引完成后自动进入知识库。
          </div>
        )}

        {messages.map((message) =>
          message.role === 'user' ? (
            <div key={message.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-3 text-sm leading-6 text-white shadow-sm">
                {message.content}
              </div>
            </div>
          ) : (
            <div key={message.id} className="flex items-start gap-3">
              <AssistantAvatar />
              <div className="min-w-0 max-w-[88%] flex-1 rounded-2xl rounded-tl-md border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                {message.status === 'searching' && <ThinkingDots label={STATUS_TEXT.searching} />}
                {!isBusyMessage(message) &&
                  message.content.length === 0 &&
                  message.status === 'generating' && (
                    <ThinkingDots label={STATUS_TEXT.generating} />
                  )}

                {message.content.length > 0 && (
                  <div className="whitespace-pre-wrap text-sm leading-6 text-gray-900 dark:text-gray-100">
                    {message.content}
                    {message.status === 'generating' && (
                      <span
                        className="ml-1 inline-block h-4 w-[2px] animate-pulse bg-blue-500 align-middle"
                        aria-hidden
                      />
                    )}
                  </div>
                )}

                {(message.sources?.length ?? 0) > 0 && (
                  <section className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
                    <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      引用来源（{message.sources?.length}）
                    </h3>
                    <ol className="mt-2 space-y-2">
                      {message.sources?.map((source, index) => (
                        <li
                          key={source.chunkId}
                          className="rounded-lg border border-gray-100 bg-white p-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
                        >
                          <div className="font-medium text-gray-900 dark:text-white">
                            [{index + 1}] {source.title}
                          </div>
                          <div className="mt-1">{(source.headingPath ?? []).join(' > ')}</div>
                          <div className="mt-1 break-all">
                            {source.sourcePath} · chunk {source.chunkIndex} · 相似度{' '}
                            {(source.similarity * 100).toFixed(1)}%
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}

                {message.status === 'error' && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                    <span>{message.errorMessage || STATUS_TEXT.error}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const retryQuestion = findRetryQuestion(messages, message);
                        if (retryQuestion) void ask(retryQuestion);
                      }}
                      className="shrink-0 font-medium text-red-700 underline hover:no-underline dark:text-red-200"
                    >
                      重试
                    </button>
                  </div>
                )}

                {message.status === 'stopped' && (
                  <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">已停止生成。</div>
                )}
              </div>
            </div>
          ),
        )}
      </div>

      <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
        <div className="mb-2 text-xs text-gray-500 dark:text-gray-400">{statusText}</div>
        <div className="flex items-end gap-2">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={2}
            disabled={isBusy || !workspace}
            placeholder="问一个当前工作区知识库里的问题"
            className="min-h-[52px] flex-1 resize-none rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          />
          {isBusy ? (
            <button
              type="button"
              onClick={stop}
              className="h-[52px] rounded-xl border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!question.trim() || !workspace}
              className="h-[52px] rounded-xl bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function isBusyMessage(message: ChatMessage) {
  return message.status === 'searching' || message.status === 'generating';
}
