// tests/helpers.js — Shared test utilities
import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', 'cli.js');

/**
 * Run a CLI command and return { stdout, stderr, exitCode }
 */
export function runCli(args, opts = {}) {
  return new Promise((resolve) => {
    const timeout = opts.timeout || 30000;
    execFile('node', [CLI, ...args], {
      timeout,
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ...opts.env },
    }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() || '',
        stderr: stderr?.toString() || '',
        exitCode: error ? error.code || 1 : 0,
      });
    });
  });
}

/**
 * Send JSON-RPC messages to the MCP server, return parsed responses.
 */
export function runMcpServer(messages, opts = {}) {
  return new Promise((resolve) => {
    const timeout = opts.timeout || 30000;
    const serverPath = path.join(__dirname, '..', 'server.js');
    const input = messages.map(m => JSON.stringify(m)).join('\n') + '\n';
    const child = execFile('node', [serverPath], {
      timeout,
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ...opts.env },
    }, (error, stdout, stderr) => {
      const responses = (stdout?.toString() || '')
        .split('\n')
        .filter(l => l.trim())
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
      resolve({ responses, stderr: stderr?.toString() || '', exitCode: error ? error.code || 1 : 0 });
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

/** Standard MCP initialize message */
export const MCP_INIT = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
};
