const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_AI_CHUNK_LENGTH,
  MAX_AI_RESPONSE_LENGTH,
  TRUNCATION_MARKER,
  appendBounded,
  truncateText,
} = require('../electron/services/aiStreamLimits');

test('main AI stream chunks and accumulated responses are explicitly bounded', () => {
  assert.equal(truncateText('x'.repeat(MAX_AI_CHUNK_LENGTH + 50), MAX_AI_CHUNK_LENGTH).length, MAX_AI_CHUNK_LENGTH);
  let state = '';
  let last;
  while (!last?.truncated) {
    last = appendBounded(state, 'x'.repeat(MAX_AI_CHUNK_LENGTH));
    state = last.value;
  }
  assert.equal(state.length, MAX_AI_RESPONSE_LENGTH);
  assert.ok(state.endsWith(TRUNCATION_MARKER));
  assert.deepEqual(appendBounded(state, 'ignored'), { value: state, delta: '', truncated: true });
});

test('renderer streams, message counts, persisted content, and progress are bounded', async () => {
  const limits = await import('../src/utils/chatLimits.mjs');
  const stream = limits.appendRendererStream('', 'x'.repeat(limits.MAX_RENDERER_STREAM_LENGTH + 100));
  assert.equal(stream.length, limits.MAX_RENDERER_STREAM_LENGTH);
  assert.ok(stream.endsWith(limits.CHAT_TRUNCATION_MARKER));
  const messages = limits.limitChatMessages(Array.from({ length: 70 }, (_, index) => ({ role: 'assistant', content: 'x'.repeat(limits.MAX_PERSISTED_MESSAGE_LENGTH + index), timestamp: index })));
  assert.equal(messages.length, limits.MAX_CHAT_MESSAGES);
  assert.ok(messages.every((message) => message.content.length <= limits.MAX_PERSISTED_MESSAGE_LENGTH));
  let progress = [];
  for (let index = 0; index < 120; index += 1) progress = limits.appendProgress(progress, { type: 'info', text: 'x'.repeat(5_000) });
  assert.equal(progress.length, limits.MAX_PROGRESS_ENTRIES);
  assert.ok(progress.every((entry) => entry.text.length <= limits.MAX_PROGRESS_TEXT_LENGTH));
});
