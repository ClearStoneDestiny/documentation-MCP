import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const serverPath = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

for (const [name, mode] of [
  ['legacy initialization', 'legacy'],
  ['modern discovery', { pin: '2026-07-28' }],
]) {
  test(`stdio supports ${name} and tool calls`, { timeout: 10_000 }, async (t) => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      // Verify resolution does not depend on the client's working directory.
      cwd: tmpdir(),
      stderr: 'pipe',
    });
    transport.stderr?.resume();
    const client = new Client(
      { name: 'documentation-mcp-smoke-test', version: '1.0.0' },
      { versionNegotiation: { mode } },
    );
    t.after(() => client.close());

    const errors = [];
    client.onerror = (error) => errors.push(error);
    await client.connect(transport, { timeout: 5_000 });

    const { tools } = await client.listTools();
    assert.ok(tools.some((tool) => tool.name === 'get_server_info'));

    const result = await client.callTool({ name: 'get_server_info', arguments: {} });
    assert.notEqual(result.isError, true);
    assert.deepEqual(result.structuredContent, {
      name: packageInfo.name,
      version: packageInfo.version,
      stage: 'scaffold',
    });
    assert.deepEqual(errors, [], 'stdout must contain only valid MCP messages');
  });
}

test('exits cleanly when stdin closes and keeps startup logs off stdout', { timeout: 5_000 }, async (t) => {
  const child = spawn(process.execPath, [serverPath], { stdio: 'pipe' });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });

  const closed = once(child, 'close');
  child.stdin.end();
  const [code, signal] = await closed;

  assert.equal(code, 0, stderr);
  assert.equal(signal, null);
  assert.equal(stdout, '');
  assert.match(stderr, /Starting Nest application/);
});
