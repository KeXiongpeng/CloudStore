import type { ChatAction, ChatMessage, ChatSource } from './types';

/** 一次回答在气泡里的生命周期。 */
export type ChatMessageStatus = 'searching' | 'generating' | 'done' | 'error' | 'stopped';

export type ChatConversationState = {
  messages: ChatMessage[];
  sessionId?: string | null;
  /** 只保留正在请求的助手消息；done/error/stop 后清除。 */
  activeAssistantId: string | null;
};

export type ChatConversationAction =
  | {
      type: 'askStart';
      userMessage: ChatMessage;
      assistantMessage: ChatMessage;
    }
  | { type: 'session'; sessionId: string; title?: string }
  | { type: 'actions'; messageId: string; actions: ChatAction[] }
  | { type: 'sources'; messageId: string; sources: ChatSource[] }
  | { type: 'delta'; messageId: string; content: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; messageId: string; message: string }
  | { type: 'stop'; messageId: string }
  | { type: 'reset' }
  | { type: 'replace'; messages: ChatMessage[] };

export function createInitialConversation(): ChatConversationState {
  return { messages: [], activeAssistantId: null, sessionId: null };
}

function updateAssistantMessage(
  state: ChatConversationState,
  messageId: string,
  update: (message: ChatMessage) => ChatMessage,
): ChatConversationState {
  // SSE 是异步事件；只更新精确匹配的助手消息，避免旧请求事件污染新对话。
  const messages = state.messages.map((message) =>
    message.id === messageId && message.role === 'assistant' ? update(message) : message,
  );
  return { ...state, messages };
}

/**
 * 对话 reducer：把 SSE 事件转换成气泡状态。
 * Controller 只负责派发事件，UI 根据 status 渲染动画/内容。
 */
export function conversationReducer(
  state: ChatConversationState,
  action: ChatConversationAction,
): ChatConversationState {
  switch (action.type) {
    case 'askStart':
      return {
        ...state,
        messages: [...state.messages, action.userMessage, action.assistantMessage],
        activeAssistantId: action.assistantMessage.id,
      };

    case 'session':
      return { ...state, sessionId: action.sessionId };

    case 'actions':
      return updateAssistantMessage(state, action.messageId, (message) => ({
        ...message,
        actions: action.actions,
      }));

    case 'sources':
      return updateAssistantMessage(state, action.messageId, (message) => ({
        ...message,
        sources: action.sources,
        status: 'generating',
      }));

    case 'delta':
      return updateAssistantMessage(state, action.messageId, (message) => ({
        ...message,
        content: message.content + action.content,
        status: 'generating',
      }));

    case 'done': {
      const nextState = updateAssistantMessage(state, action.messageId, (message) => ({
        ...message,
        status: 'done',
      }));
      return { ...nextState, activeAssistantId: null };
    }

    case 'error': {
      const nextState = updateAssistantMessage(state, action.messageId, (message) => ({
        ...message,
        status: 'error',
        errorMessage: action.message,
      }));
      return { ...nextState, activeAssistantId: null };
    }

    case 'stop': {
      const nextState = updateAssistantMessage(state, action.messageId, (message) => ({
        ...message,
        status: 'stopped',
      }));
      return { ...nextState, activeAssistantId: null };
    }

    case 'reset':
      return createInitialConversation();

    case 'replace':
      return { messages: action.messages, activeAssistantId: null };

    default:
      return state;
  }
}

/**
 * 找到失败/停止气泡对应的原始问题。
 * 优先用发送时保存的 retryQuestion；旧数据再向前回溯最近一条用户消息。
 */
export function findRetryQuestion(messages: ChatMessage[], assistantMessage: ChatMessage): string {
  const savedQuestion = assistantMessage.retryQuestion?.trim();
  if (savedQuestion) return savedQuestion;

  const index = messages.findIndex((message) => message.id === assistantMessage.id);
  for (let position = index - 1; position >= 0; position -= 1) {
    const message = messages[position];
    if (message?.role === 'user') return message.content;
  }
  return '';
}
