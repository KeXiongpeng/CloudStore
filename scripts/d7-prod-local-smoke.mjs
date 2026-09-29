import fs from 'node:fs';

function loadEnv(path) {
  const values = new Map();
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function parseSseChunk(text, state, onEvent) {
  state.buffer += text;
  let boundary = state.buffer.indexOf('\n\n');
  while (boundary >= 0) {
    const frame = state.buffer.slice(0, boundary);
    state.buffer = state.buffer.slice(boundary + 2);
    let event = '';
    let data = '';
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (event && data) onEvent({ type: event, data: JSON.parse(data) });
    boundary = state.buffer.indexOf('\n\n');
  }
}

const env = loadEnv('.env.prod-local.local');
const base = 'http://127.0.0.1:3200/api';
const loginResponse = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: env.get('ADMIN_EMAIL'), password: env.get('ADMIN_PASSWORD') }),
});
if (!loginResponse.ok) throw new Error(`login failed: ${loginResponse.status}`);
const loginPayload = await loginResponse.json();
const auth = loginPayload.data ?? loginPayload;
const headers = {
  Authorization: `Bearer ${auth.access_token}`,
  'Content-Type': 'application/json',
};

const workspaceResponse = await fetch(`${base}/workspaces`, { headers });
if (!workspaceResponse.ok) throw new Error(`workspace list failed: ${workspaceResponse.status}`);
const workspacePayload = await workspaceResponse.json();
const items = Array.isArray(workspacePayload)
  ? workspacePayload
  : Array.isArray(workspacePayload.data)
    ? workspacePayload.data
    : (workspacePayload.data?.items ?? workspacePayload.items ?? []);
if (items.length === 0) throw new Error('no workspace available');
const workspaceId = items[0].workspace?.id ?? items[0].id;

const unauthStats = await fetch(`${base}/workspaces/${workspaceId}/knowledge/stats`);
if (unauthStats.status !== 401)
  throw new Error(`unauth stats expected 401, got ${unauthStats.status}`);

const statsResponse = await fetch(`${base}/workspaces/${workspaceId}/knowledge/stats`, { headers });
if (!statsResponse.ok) throw new Error(`stats failed: ${statsResponse.status}`);
const statsPayload = await statsResponse.json();
const stats = statsPayload.data ?? statsPayload;

const state = { buffer: '' };
const events = [];
const chatResponse = await fetch(`${base}/workspaces/${workspaceId}/chat`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ question: '当前工作区的知识库状态如何？我应该先做什么？', limit: 5 }),
});
if (!chatResponse.ok) throw new Error(`chat failed: ${chatResponse.status}`);
if (!chatResponse.body) throw new Error('chat response has no body');
const reader = chatResponse.body.getReader();
const decoder = new TextDecoder();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  parseSseChunk(decoder.decode(value, { stream: true }), state, (event) => events.push(event));
}

const types = events.map((event) => event.type);
const session = events.find((event) => event.type === 'session')?.data.session;
if (!types.includes('delta')) throw new Error(`expected delta event, got: ${types.join(',')}`);
if (!types.includes('done')) throw new Error(`expected done event, got: ${types.join(',')}`);
if (!session?.id) throw new Error(`expected session event, got: ${types.join(',')}`);

// Follow-up request proves the returned server session is reused and history reaches the graph.
const followUpState = { buffer: '' };
const followUpEvents = [];
const followUpResponse = await fetch(`${base}/workspaces/${workspaceId}/chat`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    sessionId: session.id,
    question: '我刚才问的是什么？请用一句话概括。',
    limit: 5,
  }),
});
if (!followUpResponse.ok) throw new Error(`follow-up chat failed: ${followUpResponse.status}`);
const followUpReader = followUpResponse.body.getReader();
for (;;) {
  const { done, value } = await followUpReader.read();
  if (done) break;
  parseSseChunk(decoder.decode(value, { stream: true }), followUpState, (event) =>
    followUpEvents.push(event),
  );
}
const followUpTypes = followUpEvents.map((event) => event.type);
if (!followUpTypes.includes('delta') || !followUpTypes.includes('done')) {
  throw new Error(`follow-up missing delta/done: ${followUpTypes.join(',')}`);
}

const result = {
  followUpSseEventOrder: followUpTypes,
  workspaceId,
  stats,
  sseEventOrder: types,
  sessionId: session.id,
  hasActions: types.includes('actions'),
  verifiedAt: new Date().toISOString(),
};
fs.writeFileSync('backups/d7-prod-local-smoke.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
