import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runCli, runMcpServer, MCP_INIT } from './helpers.js';

describe('Smoke Tests — CLI Headless', () => {
  it('audit meta runs and finds issues', async () => {
    const { stdout } = await runCli(
      ['audit', 'https://example.com', 'meta', '--headless'],
      { timeout: 60000 }
    );
    assert.ok(stdout.includes('meta'), 'Output should contain meta audit results');
  });

  it('audit accessibility runs', async () => {
    const { stdout } = await runCli(
      ['audit', 'https://example.com', 'accessibility', '--headless'],
      { timeout: 60000 }
    );
    assert.ok(stdout.includes('accessibility'), 'Output should contain accessibility results');
  });

  it('audit color_contrast runs', async () => {
    const { stdout } = await runCli(
      ['audit', 'https://example.com', 'color_contrast', '--headless'],
      { timeout: 60000 }
    );
    assert.ok(stdout.includes('contrast') || stdout.includes('Contrast'), 'Output should contain contrast results');
  });

  it('screenshot saves to file', async () => {
    const tmpFile = path.join(os.tmpdir(), `smoke-test-${Date.now()}.png`);
    const { stdout } = await runCli(
      ['screenshot', 'https://example.com', tmpFile, '--headless'],
      { timeout: 30000 }
    );
    assert.ok(fs.existsSync(tmpFile), 'Screenshot file should exist');
    const stat = fs.statSync(tmpFile);
    assert.ok(stat.size > 1000, 'Screenshot should be > 1KB');
    fs.unlinkSync(tmpFile);
  });

  it('snap saves accessibility snapshot', async () => {
    const { stdout } = await runCli(
      ['snap', 'https://example.com', '--headless'],
      { timeout: 30000 }
    );
    assert.ok(stdout.includes('Saved:') && stdout.includes('.md'), 'Snap should save a .md file');
    // Extract filename and verify it exists
    const match = stdout.match(/Saved:\s+(\S+\.md)/);
    if (match) {
      const snapFile = path.join(
        path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
        '..',
        match[1]
      );
      if (fs.existsSync(snapFile)) {
        const content = fs.readFileSync(snapFile, 'utf8');
        assert.ok(content.includes('Example Domain'), 'Snap file should contain page text');
        fs.unlinkSync(snapFile);
      }
    }
  });
});

describe('Smoke Tests — MCP Server', () => {
  it('server initializes and lists tools', async () => {
    const { responses } = await runMcpServer([
      MCP_INIT,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ], { timeout: 15000 });

    const initResp = responses.find(r => r.id === 1);
    assert.ok(initResp?.result?.serverInfo?.name, 'Server should return serverInfo');

    const toolsResp = responses.find(r => r.id === 2);
    const toolNames = toolsResp?.result?.tools?.map(t => t.name) || [];
    assert.ok(toolNames.includes('pool_launch'), 'Should have pool_launch tool');
    assert.ok(toolNames.includes('audit_accessibility'), 'Should have audit_accessibility tool');
    assert.ok(toolNames.includes('browser_navigate'), 'Should have browser_navigate tool');
    assert.ok(toolNames.length >= 60, `Should have 60+ tools, got ${toolNames.length}`);
  });
});
