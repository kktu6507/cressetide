import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const evalRoot = path.dirname(fileURLToPath(import.meta.url));
const casesRoot = path.join(evalRoot, 'cases');
const capabilities = new Set(['vigil', 'salvage', 'map', 'doctor', 'ship']);
const allowedKeys = new Set([
  'id',
  'capability',
  'fixture',
  'prompt',
  'evidence',
  'requiredTerms',
  'forbiddenTerms',
  'rationale'
]);

function usage() {
  return 'Usage: node eval/run-eval.mjs [--responses <directory>]';
}

function parseArguments(argv) {
  if (argv.length === 0) return { responses: null };
  if (argv.length === 2 && argv[0] === '--responses' && argv[1].trim()) {
    return { responses: path.resolve(argv[1]) };
  }
  throw new Error(usage());
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function requireStringArray(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
  }
  const seen = new Set();
  for (const item of value) {
    requireString(item, `${label} item`);
    const canonical = item.toLocaleLowerCase('en-US');
    if (seen.has(canonical)) throw new Error(`${label} contains a duplicate term: ${item}`);
    seen.add(canonical);
  }
  return seen;
}

function validateTextIntegrity(text, label) {
  if (text.includes('\uFFFD')) throw new Error(`${label} contains a replacement character`);
  if (/[^\n\r\t\x20-\uFFFF]/u.test(text)) {
    throw new Error(`${label} contains an unsupported control character`);
  }
}

function validateCase(candidate, filename) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error(`${filename} must contain one JSON object`);
  }
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) throw new Error(`${filename} has unknown key: ${key}`);
  }

  requireString(candidate.id, `${filename}.id`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.id)) {
    throw new Error(`${filename}.id must be lowercase kebab-case`);
  }
  if (`${candidate.id}.json` !== filename) {
    throw new Error(`${filename} must match case id ${candidate.id}`);
  }
  if (!capabilities.has(candidate.capability)) {
    throw new Error(`${filename}.capability must be vigil, salvage, map, doctor, or ship`);
  }
  if (candidate.fixture !== 'fictional') {
    throw new Error(`${filename}.fixture must be fictional`);
  }
  requireString(candidate.prompt, `${filename}.prompt`);
  requireString(candidate.rationale, `${filename}.rationale`);
  const required = requireStringArray(candidate.requiredTerms, `${filename}.requiredTerms`);
  const forbidden = requireStringArray(
    candidate.forbiddenTerms,
    `${filename}.forbiddenTerms`,
    { allowEmpty: true }
  );
  requireStringArray(candidate.evidence, `${filename}.evidence`);

  for (const term of required) {
    if (forbidden.has(term)) {
      throw new Error(`${filename} requires and forbids the same term: ${term}`);
    }
  }

  const serialized = JSON.stringify(candidate);
  validateTextIntegrity(serialized, filename);
  if (/[A-Za-z]:[\\/]|(?:^|\s)\/(?:home|Users|var|etc)\//u.test(serialized)) {
    throw new Error(`${filename} contains an absolute machine path`);
  }
  if (/https?:\/\//u.test(serialized)) {
    throw new Error(`${filename} contains a network location`);
  }

  return Object.freeze(candidate);
}

async function loadCases() {
  const filenames = (await readdir(casesRoot))
    .filter((name) => name.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b, 'en'));
  if (filenames.length === 0) throw new Error('eval/cases contains no JSON cases');

  const ids = new Set();
  const cases = [];
  for (const filename of filenames) {
    const source = await readFile(path.join(casesRoot, filename), 'utf8');
    validateTextIntegrity(source, filename);
    const candidate = validateCase(JSON.parse(source), filename);
    if (ids.has(candidate.id)) throw new Error(`duplicate case id: ${candidate.id}`);
    ids.add(candidate.id);
    cases.push(candidate);
  }
  return cases;
}

async function confirmDirectory(directory) {
  const details = await stat(directory);
  if (!details.isDirectory()) throw new Error(`${directory} is not a directory`);
}

async function scoreResponses(cases, responsesRoot) {
  await confirmDirectory(responsesRoot);
  const failures = [];

  for (const testCase of cases) {
    const responsePath = path.join(responsesRoot, `${testCase.id}.md`);
    let response;
    try {
      response = await readFile(responsePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        failures.push(`${testCase.id}: missing response`);
        continue;
      }
      throw error;
    }
    validateTextIntegrity(response, `${testCase.id}.md`);

    const missing = testCase.requiredTerms.filter((term) => !response.includes(term));
    const present = testCase.forbiddenTerms.filter((term) => response.includes(term));
    if (missing.length > 0) {
      failures.push(`${testCase.id}: missing ${missing.join(', ')}`);
    }
    if (present.length > 0) {
      failures.push(`${testCase.id}: forbidden ${present.join(', ')}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`response rubric failed\n${failures.map((item) => `- ${item}`).join('\n')}`);
  }
}

try {
  const options = parseArguments(process.argv.slice(2));
  const cases = await loadCases();
  const counts = Object.fromEntries([...capabilities].sort().map((name) => [name, 0]));
  for (const testCase of cases) counts[testCase.capability] += 1;

  if (options.responses) await scoreResponses(cases, options.responses);

  const mode = options.responses ? 'dataset+responses' : 'dataset';
  const distribution = Object.entries(counts)
    .map(([name, count]) => `${name}=${count}`)
    .join(' ');
  console.log(`Cressetide eval PASS mode=${mode} cases=${cases.length} ${distribution}`);
} catch (error) {
  console.error(`Cressetide eval FAIL: ${error.message}`);
  process.exitCode = 1;
}
