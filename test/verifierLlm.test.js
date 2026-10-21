const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { defaultLlmSettings } = require('../core/verifier/generated/domain/llmConfig');
const { validateLlmSettings } = require('../core/verifier/generated/domain/llmSettings');
const { parseProposals, redactFeedback } = require('../core/verifier/generated/domain/llmProposal');
const { createLlmProposer } = require('../core/verifier/generated/application/llmProposer');
const { createLocalProvider, createRemoteProvider } = require('../core/verifier/generated/adapters/llmProviders');
const { createGeneticFixtureService } = require('../core/verifier/generated/adapters/geneticFixtureService');
const { defaultGeneticFixtureSettings, compoundSpace } = require('../core/verifier/generated/domain/geneticFixtureConfig');
const { individual } = require('../core/verifier/generated/domain/geneticEvolution');
const { makeGenome } = require('../core/verifier/generated/domain/geneticGenome');
const { parseCommand } = require('../core/verifier/generated/cli/arguments');

const space = [{ field: 'n', values: [0, 1, 2], optional: false }, { field: 'tag', values: ['a', 'b'], optional: true }];
const text = value => JSON.stringify({ candidates: value });
const on = changes => ({ ...defaultLlmSettings(), mode: 'mock', ...changes });
const ctx = { generation: 1, capacity: 8, evaluated: [], signal: new AbortController().signal };

test('settings accept only bounded values and numeric loopback endpoints', () => {
  assert.equal(validateLlmSettings(defaultLlmSettings()).mode, 'disabled');
  const local = { ...defaultLlmSettings(), mode: 'local', model: 'm', endpoint: 'http://127.0.0.1:8080/' };
  assert.equal(validateLlmSettings(local).endpoint, 'http://127.0.0.1:8080');
  for (const endpoint of ['https://127.0.0.1:1/', 'http://example.com/', 'http://localhost:1/', 'http://user:pw@127.0.0.1:1/', 'http://127.0.0.1:1/x', 'http://10.0.0.1/'])
    assert.throws(() => validateLlmSettings({ ...local, endpoint }), undefined, endpoint);
  assert.throws(() => validateLlmSettings({ ...local, endpoint: null }));
  assert.throws(() => validateLlmSettings({ ...defaultLlmSettings(), endpoint: 'http://127.0.0.1:1/' }));
  assert.throws(() => validateLlmSettings({ ...defaultLlmSettings(), candidateRatio: 1.5 }));
  assert.throws(() => validateLlmSettings({ ...defaultLlmSettings(), maxCalls: Infinity }));
  assert.throws(() => validateLlmSettings({ ...defaultLlmSettings(), extra: 1 }));
});

test('model output is rejected unless it is exactly typed, bounded and in vocabulary', () => {
  const ok = parseProposals(text([{ values: { n: 1, tag: 'a' } }, { values: { n: 1, tag: 'a' } }, { values: { n: 2 } }]), space, 4, 1000);
  assert.equal(ok.length, 2);
  assert.deepEqual(ok[1].omitFields, ['tag']);
  const bad = {
    invalid_json: '{"candidates":[{"values":{"n":1', oversized: text([{ values: { n: 1 } }]).padEnd(2000, ' '),
    invalid_shape: '[]', too_many: text(Array.from({ length: 5 }, () => ({ values: { n: 1 } }))),
    unknown_field: text([{ values: { n: 1, admin: true } }]), invalid_value: text([{ values: { n: '1' } }]),
    empty: text([]),
  };
  for (const [code, input] of Object.entries(bad)) assert.throws(() => parseProposals(input, space, 4, 1000), { message: `LLM response rejected: ${code}` });
  assert.throws(() => parseProposals(text([{ values: { tag: 'a' } }]), space, 4, 1000), /invalid_value/);
  assert.throws(() => parseProposals(text([{ values: { n: 9 } }]), space, 4, 1000), /invalid_value/);
  assert.throws(() => parseProposals('{"candidates":[{"values":{"__proto__":{"n":1}}}]}', space, 4, 1000), /unknown_field/);
  assert.throws(() => parseProposals(text([{ values: { n: 1 }, url: 'http://x' }]), space, 4, 1000), /invalid_shape/);
});

test('feedback sent to the model contains only typed values and aggregates', () => {
  const entry = { individual: individual('secret-id', 1, makeGenome('s', [7, 11, 13], compoundSpace), 'initial', [], compoundSpace),
    fitness: { eligible: true, score: 3, reachability: { state: 'observed', value: 2 } } };
  const out = redactFeedback([entry, { ...entry, fitness: { ...entry.fitness, eligible: false } }]);
  assert.equal(out.length, 1);
  assert.deepEqual(Object.keys(out[0]).sort(), ['reachability', 'score', 'values']);
  assert.ok(!JSON.stringify(out).includes('secret-id'));
});

test('proposer retries finitely, then falls back; budgets and ratio are honored', async () => {
  let calls = 0;
  const flaky = responses => ({ async complete() { const next = responses[Math.min(calls++, responses.length - 1)]; if (next instanceof Error) throw next; return { text: next, promptTokens: 10, completionTokens: 10 }; } });
  const good = text([{ values: { n: 1 } }, { values: { n: 2 } }]);
  let proposer = createLlmProposer(flaky(['not json', good]), on({ maxRetries: 1 }), space);
  let out = await proposer.propose(ctx);
  assert.equal(out.record.outcome, 'proposed'); assert.equal(out.record.attempts, 2); assert.equal(out.seeds.length, 2);
  assert.equal(out.record.tokens, 40);
  calls = 0; proposer = createLlmProposer(flaky(['not json']), on({ maxRetries: 2 }), space);
  out = await proposer.propose(ctx);
  assert.deepEqual([out.record.outcome, out.record.attempts, out.record.rejection, out.seeds.length], ['fallback', 3, 'invalid_json', 0]);
  calls = 0; proposer = createLlmProposer(flaky([new Error('boom')]), on({ maxRetries: 0 }), space);
  assert.equal((await proposer.propose(ctx)).record.outcome, 'fallback');
  calls = 0; proposer = createLlmProposer(flaky([good]), on({ maxCalls: 1 }), space);
  await proposer.propose(ctx);
  out = await proposer.propose(ctx);
  assert.equal(out.record.rejection, 'call_budget'); assert.equal(calls, 1);
  calls = 0; proposer = createLlmProposer(flaky([good]), on({ maxTotalTokens: 20 }), space);
  await proposer.propose(ctx);
  assert.equal((await proposer.propose(ctx)).record.rejection, 'token_budget');
  calls = 0; proposer = createLlmProposer(flaky([good]), on({ candidateRatio: 0 }), space);
  assert.equal((await proposer.propose(ctx)).record.outcome, 'skipped'); assert.equal(calls, 0);
  proposer = createLlmProposer(flaky([good]), { ...on(), mode: 'disabled' }, space);
  assert.equal((await proposer.propose(ctx)).record.outcome, 'skipped');
  calls = 0; proposer = createLlmProposer(flaky([good]), on({ candidateRatio: 0.25 }), space);
  assert.equal((await proposer.propose({ ...ctx, capacity: 8 })).seeds.length, 2);
});

async function withServer(handler, run) {
  const requests = [];
  const server = http.createServer((req, res) => { let body = ''; req.on('data', c => { body += c; }); req.on('end', () => { requests.push({ headers: req.headers, url: req.url, body }); handler(req, res, requests.length); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`, requests); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const reply = (res, content, extra = {}) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop', ...extra }], usage: { prompt_tokens: 5, completion_tokens: 7 } })); };
const request = signal => ({ system: 's', prompt: 'p', schema: { type: 'object' }, context: { space, feedback: [], maxProposals: 2 }, maxTokens: 64, maxBytes: 512, signal: signal ?? new AbortController().signal });

test('local provider speaks the loopback chat API and rejects unsafe replies', async () => {
  await withServer((req, res) => reply(res, '{"candidates":[]}'), async (origin, requests) => {
    const done = await createLocalProvider(origin, 'm').complete(request());
    assert.deepEqual([done.text, done.promptTokens, done.completionTokens], ['{"candidates":[]}', 5, 7]);
    const sent = JSON.parse(requests[0].body);
    assert.equal(requests[0].url, '/v1/chat/completions');
    assert.equal(sent.response_format.type, 'json_schema'); assert.equal(sent.max_tokens, 64); assert.equal(sent.stream, false);
    assert.equal(requests[0].headers.authorization, undefined); assert.equal(requests[0].headers.cookie, undefined);
  });
  const failures = {
    truncated: (req, res) => reply(res, '{"cand', { finish_reason: 'length' }),
    refused: (req, res) => reply(res, '', { finish_reason: 'content_filter' }),
    invalid_shape: (req, res) => { res.end('{"choices":[]}'); },
    invalid_json: (req, res) => { res.end('nope'); },
    transport: (req, res) => { res.statusCode = 500; res.end('x'); },
    oversized: (req, res) => { res.end('x'.repeat(20_000)); },
  };
  for (const [code, handler] of Object.entries(failures)) {
    await withServer(handler, origin => assert.rejects(() => createLocalProvider(origin, 'm').complete(request()), { message: `LLM response rejected: ${code}` }));
  }
  await withServer((req, res) => { res.statusCode = 302; res.setHeader('location', 'http://example.com/'); res.end(); },
    origin => assert.rejects(() => createLocalProvider(origin, 'm').complete(request()), /transport/));
  await withServer(() => {}, origin => assert.rejects(() => createLocalProvider(origin, 'm').complete(request(AbortSignal.timeout(50))), /timeout/));
  assert.throws(() => createLocalProvider('http://example.com', 'm'));
});

const dataRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-llm-'));
const runCampaign = async (llm, extra = {}, mode = 'changed') => {
  const root = dataRoot();
  try { return await createGeneticFixtureService({ applicationVersion: 't', dataRoot: root, ...extra }).run({ mode, settings: defaultGeneticFixtureSettings(), llm }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
};

test('model-assisted search uses the same HTTP budget and records proposals', async () => {
  const assisted = await runCampaign(on({ candidateRatio: 0.5 }));
  const plain = await runCampaign(defaultLlmSettings());
  assert.equal(plain.report.search.proposals.length, 0);
  // The neighbour-climbing mock is a test double, not a performance claim; comparison is measured separately.
  assert.ok(['reproduced', 'not_attempted'].includes(assisted.report.reproduction.state));
  assert.ok(assisted.report.trials <= assisted.report.options.settings.maxTrials);
  assert.ok(assisted.report.search.proposals.length > 0);
  assert.equal(assisted.report.search.proposals.filter(p => p.outcome === 'proposed').length, 8);
  assert.ok(assisted.report.search.proposals.filter(p => p.outcome === 'fallback').every(p => p.rejection === 'call_budget' && p.attempts === 0));
  assert.ok(assisted.report.search.proposals.every(p => p.accepted <= 8));
  const llmIndividuals = assisted.report.search.generations.flatMap(g => g.individuals).filter(e => e.individual.operator === 'llm');
  assert.ok(llmIndividuals.length > 0);
  for (const generation of assisted.report.search.generations) assert.ok(generation.individuals.filter(e => e.individual.operator === 'llm').length <= 8);
  assert.ok(!JSON.stringify(assisted.report).includes('"text"'));
});

test('a failing model never changes the GA outcome or exceeds budgets', async () => {
  const broken = { async complete() { throw new Error('down'); } };
  const fallback = await runCampaign(on(), { llmProvider: broken });
  const plain = await runCampaign(defaultLlmSettings());
  assert.ok(fallback.report.search.proposals.every(p => p.outcome === 'fallback' || p.rejection === 'call_budget'));
  const seeds = result => result.report.search.generations.map(g => g.individuals.map(e => e.individual.seed.values));
  assert.deepEqual(seeds(fallback), seeds(plain));
  assert.equal(fallback.report.reproduction.state, plain.report.reproduction.state);
  assert.equal(fallback.report.trials, plain.report.trials);
});

test('model proposals cannot cross the fixed scope and baseline stays unreproduced', async () => {
  const hostile = { async complete() { return { text: text([{ values: { x: 7, y: 11, z: 13, admin: true } }]), promptTokens: null, completionTokens: null }; } };
  const result = await runCampaign(on(), { llmProvider: hostile }, 'changed');
  assert.ok(result.report.search.proposals.every(p => p.outcome === 'fallback'));
  const baseline = await runCampaign(on());
  assert.equal(baseline.report.reproduction.state, 'not_attempted');
});

test('CLI exposes the model option with validation', () => {
  assert.equal(parseCommand(['--genetic-fixture', '--llm', 'mock']).options.llm.mode, 'mock');
  assert.equal(parseCommand(['--genetic-fixture']).options.llm.mode, 'disabled');
  assert.throws(() => parseCommand(['--genetic-fixture', '--llm', 'local']));
  assert.throws(() => parseCommand(['--genetic-fixture', '--llm', 'local', '--llm-model', 'm', '--llm-endpoint', 'https://api.example.com']));
  assert.throws(() => parseCommand(['--genetic-fixture', '--llm', 'remote']));
});

const remote = changes => ({ ...defaultLlmSettings(), mode: 'remote', model: 'm', endpoint: 'https://api.example.com/', sendPermission: true, apiKeyEnv: 'LLM_API_KEY',
  maxCost: 1, pricing: { inputPerMillion: 1, outputPerMillion: 2 }, ...changes });

test('remote sending needs explicit permission, https, a key variable name and a cost ceiling', () => {
  assert.equal(validateLlmSettings(remote()).endpoint, 'https://api.example.com');
  for (const changes of [{ sendPermission: false }, { endpoint: 'http://api.example.com/' }, { endpoint: 'https://u:p@api.example.com/' }, { endpoint: 'https://api.example.com/x' },
    { apiKeyEnv: null }, { apiKeyEnv: 'sk-live-secret' }, { apiKeyEnv: 'lower' }, { maxCost: 0 }, { pricing: { inputPerMillion: -1, outputPerMillion: 0 } }])
    assert.throws(() => validateLlmSettings(remote(changes)), undefined, JSON.stringify(changes));
  assert.throws(() => validateLlmSettings({ ...defaultLlmSettings(), sendPermission: true }));
  assert.throws(() => validateLlmSettings({ ...defaultLlmSettings(), apiKeyEnv: 'LLM_API_KEY' }));
});

test('remote provider sends the key only as a bearer header and records neither key nor output', async () => {
  const seen = [];
  const fetcher = async (url, init) => { seen.push({ url: String(url), init }); return new Response(JSON.stringify({ choices: [{ message: { content: text([{ values: { n: 1 } }]) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } })); };
  const provider = createRemoteProvider('https://api.example.com', 'm', 'TOPSECRET', fetcher);
  const done = await provider.complete(request());
  assert.equal(done.completionTokens, 50);
  assert.equal(seen[0].url, 'https://api.example.com/v1/chat/completions');
  assert.equal(seen[0].init.headers.authorization, 'Bearer TOPSECRET');
  assert.ok(!seen[0].init.body.includes('TOPSECRET'));
  assert.throws(() => createRemoteProvider('https://api.example.com', 'm', ''));
  assert.throws(() => createRemoteProvider('http://api.example.com', 'm', 'k'));
  const result = await runCampaign(remote({ maxCost: 100 }), { env: { LLM_API_KEY: 'TOPSECRET' }, llmProvider: provider });
  assert.ok(!JSON.stringify(result.report).includes('TOPSECRET'));
  assert.ok(result.report.search.proposals.some(p => p.cost > 0));
  await assert.rejects(() => runCampaign(remote(), { env: {} }), /API key/);
});

test('cost ceiling stops model calls before they are made', async () => {
  let calls = 0;
  const provider = { async complete() { calls++; return { text: text([{ values: { n: 1 } }]), promptTokens: 1000, completionTokens: 1000 }; } };
  // 1M-token prices: each call costs 3000 tokens-ish; the second call would exceed the ceiling.
  const settings = remote({ pricing: { inputPerMillion: 1000, outputPerMillion: 1000 }, maxCost: 2.1, maxResponseTokens: 100 });
  const proposer = createLlmProposer(provider, settings, space);
  assert.equal((await proposer.propose(ctx)).record.outcome, 'proposed');
  const second = await proposer.propose(ctx);
  assert.deepEqual([second.record.rejection, calls], ['cost_budget', 1]);
  const tight = createLlmProposer(provider, remote({ maxCost: 0.0001, pricing: { inputPerMillion: 1000, outputPerMillion: 1000 } }), space);
  assert.equal((await tight.propose(ctx)).record.rejection, 'cost_budget');
  assert.equal(calls, 1);
});

test('CLI remote options are validated', () => {
  const base = ['--genetic-fixture', '--llm', 'remote', '--llm-endpoint', 'https://api.example.com', '--llm-model', 'm', '--llm-api-key-env', 'LLM_API_KEY', '--llm-max-cost', '2'];
  assert.throws(() => parseCommand(base));
  const ok = parseCommand([...base, '--llm-send-permission', '--llm-input-price', '1.5']);
  assert.equal(ok.options.llm.sendPermission, true); assert.equal(ok.options.llm.pricing.inputPerMillion, 1.5);
  assert.throws(() => parseCommand([...base, '--llm-send-permission', '--llm-max-cost', 'abc']));
});

// Opt-in: WSH_LLM_ENDPOINT=http://127.0.0.1:PORT WSH_LLM_MODEL=name npm test (real runtime, e.g. llama.cpp server).
test('real loopback runtime obeys the strict schema', { skip: !process.env.WSH_LLM_ENDPOINT }, async () => {
  const result = await runCampaign({ ...defaultLlmSettings(), mode: 'local', endpoint: process.env.WSH_LLM_ENDPOINT, model: process.env.WSH_LLM_MODEL || 'local',
    candidateRatio: 0.5, maxCalls: 4, timeoutMs: 120_000 }, {}, 'changed');
  assert.ok(result.report.search.proposals.some(p => p.outcome === 'proposed'));
  assert.ok(result.report.trials <= result.report.options.settings.maxTrials);
});
