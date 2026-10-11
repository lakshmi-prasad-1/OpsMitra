import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'opsmitra-assistant-test-'));
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_PATH = join(dir, 'assistant.sqlite');
process.env.JWT_SECRET = 'assistant-test-secret-with-more-than-32-characters';
delete process.env.ANTHROPIC_API_KEY;
const { pool } = await import('../src/db.js');
const { seedWorkspace } = await import('../src/services/demoSeed.js');
const { ask, setAnthropicClient, TOOLS, assistantMode } = await import('../src/services/assistant.js');

after(async () => { await pool.close(); rmSync(dir, { recursive: true, force: true }); });

const [{ insertId: ownerId }] = await pool.execute("INSERT INTO users (name, email, password_hash, business_name) VALUES ('Asha', 'asha@example.com', 'x', 'Asha Stores')");
const connection = await pool.getConnection();
await connection.beginTransaction(); await seedWorkspace(connection, Number(ownerId)); await connection.commit(); connection.release();
const owner = Number(ownerId);

/** Scripted stand-in for the Anthropic SDK client. */
function fakeClient(script) {
  const calls = [];
  return { calls, messages: { create: async params => { calls.push(structuredClone(params)); const next = script.shift(); if (next instanceof Error) throw next; return next; } } };
}
const text = t => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const toolUse = (name, input = {}, id = 'toolu_1') => ({ stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id, name, input }] });

test('without an API key the built-in engine answers and is labelled offline', async () => {
  assert.equal(assistantMode(), 'offline');
  const r = await ask(owner, 'Who owes me money?');
  assert.equal(r.mode, 'offline');
  assert.match(r.answer, /owe you/);
  assert.deepEqual(r.sources, ['customer_dues']);
});

test('every tool declares a strict schema and runs read-only against the owner', async () => {
  for (const tool of TOOLS) {
    assert.equal(tool.input_schema.additionalProperties, false, `${tool.name} schema must be closed`);
    assert.ok(tool.description.length > 20);
  }
  const summary = await TOOLS.find(t => t.name === 'sales_summary').run(owner, { range: '30d' });
  assert.ok(summary.current.revenue > 0);
  // Another owner sees none of it.
  const [{ insertId: other }] = await pool.execute("INSERT INTO users (name, email, password_hash) VALUES ('Other', 'other@example.com', 'x')");
  const theirs = await TOOLS.find(t => t.name === 'sales_summary').run(Number(other), { range: '30d' });
  assert.equal(theirs.current.revenue, 0);
});

test('Claude path: tool_use round trip returns the final text and feeds real results back', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const fake = fakeClient([toolUse('sales_summary', { range: 'month' }), text('Sales this month are strong.')]);
  setAnthropicClient(fake);
  const r = await ask(owner, 'How are sales this month?', [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello' }], 'Asha Stores');
  assert.equal(r.mode, 'claude');
  assert.equal(r.answer, 'Sales this month are strong.');
  assert.deepEqual(r.sources, ['sales_summary']);
  assert.equal(fake.calls.length, 2);

  const first = fake.calls[0];
  assert.equal(first.model, 'claude-opus-5-5');
  assert.equal(first.output_config.effort, 'low');
  assert.match(first.system, /Asha Stores/);
  assert.equal(first.tools.length, TOOLS.length);
  assert.ok(first.tools.every(t => t.name && t.description && t.input_schema));
  assert.deepEqual(first.messages.map(m => m.role), ['user', 'assistant', 'user']);
  assert.equal(first.tool_choice, undefined, 'forced tool choice is not supported on Opus 5.5');

  const second = fake.calls[1];
  assert.equal(second.messages.at(-2).role, 'assistant');
  assert.ok(second.messages.at(-2).content.some(b => b.type === 'tool_use'), 'assistant turn is replayed unchanged, thinking block included');
  const result = second.messages.at(-1);
  assert.equal(result.role, 'user');
  assert.equal(result.content[0].type, 'tool_result');
  assert.equal(result.content[0].tool_use_id, 'toolu_1');
  assert.ok(JSON.parse(result.content[0].content).current.revenue > 0, 'tool result carries real figures');
});

test('Claude path: unknown tools return an error result instead of crashing', async () => {
  const fake = fakeClient([toolUse('drop_database', {}, 'toolu_x'), text('Sorry, I cannot do that.')]);
  setAnthropicClient(fake);
  const r = await ask(owner, 'delete everything');
  assert.equal(r.mode, 'claude');
  const sent = fake.calls[1].messages.at(-1).content[0];
  assert.equal(sent.is_error, true);
});

test('Claude path: API failures and refusals fall back to the built-in engine with a notice', async () => {
  setAnthropicClient(fakeClient([new Error('connect ECONNREFUSED')]));
  const down = await ask(owner, 'What should I restock?');
  assert.equal(down.mode, 'offline');
  assert.match(down.notice, /unavailable/);
  assert.ok(down.answer.length > 10);

  setAnthropicClient(fakeClient([{ stop_reason: 'refusal', content: [] }]));
  const refused = await ask(owner, 'What should I restock?');
  assert.equal(refused.mode, 'offline');
  assert.match(refused.notice, /declined/);

  setAnthropicClient(fakeClient([{ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'cut' }] }]));
  assert.equal((await ask(owner, 'What should I restock?')).mode, 'offline');
  delete process.env.ANTHROPIC_API_KEY;
});
