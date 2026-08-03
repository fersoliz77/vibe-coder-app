export const MAX_CHAT_MESSAGES = 50;
export const MAX_PERSISTED_MESSAGE_LENGTH = 200 * 1024;
export const MAX_RENDERER_STREAM_LENGTH = 1024 * 1024;
export const MAX_PROGRESS_ENTRIES = 100;
export const MAX_PROGRESS_TEXT_LENGTH = 4 * 1024;
export const CHAT_TRUNCATION_MARKER = '\n[truncated]';

export function truncateChatText(value, limit = MAX_PERSISTED_MESSAGE_LENGTH) {
  const text = String(value || '');
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - CHAT_TRUNCATION_MARKER.length))}${CHAT_TRUNCATION_MARKER}`;
}

export function appendRendererStream(current, chunk) {
  const existing = String(current || '');
  if (existing.endsWith(CHAT_TRUNCATION_MARKER)) return existing;
  return truncateChatText(existing + String(chunk || ''), MAX_RENDERER_STREAM_LENGTH);
}

export function limitChatMessages(messages) {
  return (Array.isArray(messages) ? messages : []).slice(-MAX_CHAT_MESSAGES).map((message) => ({
    role: ['user', 'assistant', 'error'].includes(message?.role) ? message.role : 'error',
    content: truncateChatText(message?.content),
    timestamp: Number.isFinite(message?.timestamp) ? message.timestamp : Date.now(),
  }));
}

export function appendProgress(entries, entry) {
  const next = [...(Array.isArray(entries) ? entries : []), {
    type: String(entry?.type || 'info').slice(0, 20),
    text: truncateChatText(entry?.text, MAX_PROGRESS_TEXT_LENGTH),
  }];
  return next.slice(-MAX_PROGRESS_ENTRIES);
}
