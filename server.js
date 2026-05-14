const express = require('express');
const Anthropic = require('@anthropic-ai/sdk').default;
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let WORKSPACE = process.env.WORKSPACE || process.cwd();

// ── Tool definitions ──
const tools = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the given path.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates if not exists, overwrites if does.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
  {
    name: 'list_files',
    description: 'List files and directories at the given path.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'run_command',
    description: 'Execute a shell command and return stdout/stderr.',
    input_schema: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' } }, required: ['command'] },
  },
  {
    name: 'search_files',
    description: 'Search for a text pattern across files.',
    input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' } }, required: ['pattern'] },
  },
];

async function executeTool(name, input) {
  try {
    switch (name) {
      case 'read_file': {
        const p = path.resolve(WORKSPACE, input.path);
        return { type: 'text', text: fs.readFileSync(p, 'utf-8').slice(0, 50000) };
      }
      case 'write_file': {
        const p = path.resolve(WORKSPACE, input.path);
        const dir = path.dirname(p);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(p, input.content, 'utf-8');
        return { type: 'text', text: `File written: ${input.path} (${input.content.length} chars)` };
      }
      case 'list_files': {
        const dirPath = path.resolve(WORKSPACE, input.path || '.');
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const result = entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
          size: e.isFile() ? fs.statSync(path.join(dirPath, e.name)).size : null,
        }));
        return { type: 'text', text: JSON.stringify(result, null, 2) };
      }
      case 'run_command': {
        const cwd = input.cwd ? path.resolve(WORKSPACE, input.cwd) : WORKSPACE;
        const output = execSync(input.command, { cwd, timeout: 30000, maxBuffer: 1024 * 1024, encoding: 'utf-8', shell: true });
        return { type: 'text', text: output.slice(0, 30000) || '(no output)' };
      }
      case 'search_files': {
        const searchPath = path.resolve(WORKSPACE, input.path || '.');
        const glob = input.glob || '*';
        try {
          const output = execSync(`grep -rn "${input.pattern.replace(/"/g, '\\"')}" --include="${glob}" "${searchPath}" 2>/dev/null | head -50`, { encoding: 'utf-8', timeout: 10000, shell: true });
          return { type: 'text', text: output || 'No matches found.' };
        } catch { return { type: 'text', text: 'No matches found.' }; }
      }
      default: return { type: 'text', text: `Unknown tool: ${name}` };
    }
  } catch (error) {
    return { type: 'text', text: `Error: ${error.message}` };
  }
}

// ── Create Anthropic client per request (supports user-provided config) ──
function createClient(config) {
  const opts = {};
  if (config.apiKey) opts.apiKey = config.apiKey;
  else if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) opts.apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;

  if (config.baseURL) opts.baseURL = config.baseURL;
  else if (process.env.ANTHROPIC_BASE_URL) opts.baseURL = process.env.ANTHROPIC_BASE_URL;

  return new Anthropic(opts);
}

function getModel(config) {
  return config.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
}

// ── Chat endpoint ──
app.post('/api/chat', async (req, res) => {
  const { messages, system, config = {}, workspace: ws } = req.body;

  if (ws && fs.existsSync(ws)) WORKSPACE = ws;

  const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify({ type: 'error', error: '请先在设置中填写 API Key。如果在国内网络环境，请同时设置 API 代理地址。' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    return res.end();
  }

  const client = createClient(config);
  const model = getModel(config);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    let currentMessages = [...messages];
    let continueLoop = true;

    while (continueLoop) {
      const stream = await client.messages.stream({
        model,
        max_tokens: 4096,
        system: system || '你是 Claude，由 Anthropic 开发的 AI 助手。你可以读写文件、执行命令、搜索代码。请用用户的语言回复。',
        messages: currentMessages,
        tools,
      });

      let assistantContent = [];

      await new Promise((resolve) => {
        stream.on('text', (text) => sendEvent({ type: 'text', text }));
        stream.on('message', (msg) => { assistantContent = msg.content; });
        stream.on('error', (error) => { sendEvent({ type: 'error', error: error.message }); continueLoop = false; resolve(); });
        stream.on('end', () => resolve());
      });

      const toolUseBlocks = assistantContent.filter(b => b.type === 'tool_use');

      if (toolUseBlocks.length === 0) {
        continueLoop = false;
        sendEvent({ type: 'done' });
      } else {
        currentMessages.push({ role: 'assistant', content: assistantContent });
        const toolResults = [];
        for (const tb of toolUseBlocks) {
          sendEvent({ type: 'tool_use', id: tb.id, name: tb.name, input: tb.input });
          const result = await executeTool(tb.name, tb.input);
          sendEvent({ type: 'tool_result', id: tb.id, name: tb.name, result: result.text });
          toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: [result] });
        }
        currentMessages.push({ role: 'user', content: toolResults });
      }
    }
  } catch (error) {
    sendEvent({ type: 'error', error: error.message });
    sendEvent({ type: 'done' });
  } finally {
    res.end();
  }
});

app.get('/api/workspace', (req, res) => res.json({ path: WORKSPACE }));
app.post('/api/workspace', (req, res) => {
  const { path: newPath } = req.body;
  if (newPath && fs.existsSync(newPath)) {
    WORKSPACE = newPath;
    res.json({ ok: true, path: WORKSPACE });
  } else {
    res.status(400).json({ error: '目录不存在' });
  }
});

app.get('/api/workspace/files', (req, res) => {
  const dirPath = req.query.path || WORKSPACE;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const files = entries
      .filter(e => !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })
      .map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        path: path.join(dirPath, e.name),
      }));
    res.json(files);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Claude Desktop running at http://localhost:${PORT}`);
  console.log(`Workspace: ${WORKSPACE}`);
});
