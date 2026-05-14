const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk').default;
const fs = require('fs');
const { execSync } = require('child_process');

const expressApp = express();
expressApp.use(express.json());
expressApp.use(express.static(path.join(__dirname, 'public')));

let WORKSPACE = process.env.WORKSPACE || process.cwd();

const tools = [
  { name: 'read_file', description: 'Read file contents.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: 'Write content to a file.', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'list_files', description: 'List files and directories.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'run_command', description: 'Execute a shell command.', input_schema: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' } }, required: ['command'] } },
  { name: 'search_files', description: 'Search text across files.', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' } }, required: ['pattern'] } },
];

async function executeTool(name, input) {
  try {
    switch (name) {
      case 'read_file': return { type: 'text', text: fs.readFileSync(path.resolve(WORKSPACE, input.path), 'utf-8').slice(0, 50000) };
      case 'write_file': {
        const p = path.resolve(WORKSPACE, input.path);
        if (!fs.existsSync(path.dirname(p))) fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, input.content, 'utf-8');
        return { type: 'text', text: `Written: ${input.path} (${input.content.length} chars)` };
      }
      case 'list_files': {
        const dirPath = path.resolve(WORKSPACE, input.path || '.');
        return { type: 'text', text: JSON.stringify(fs.readdirSync(dirPath, { withFileTypes: true }).map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })), null, 2) };
      }
      case 'run_command': {
        const output = execSync(input.command, { cwd: input.cwd ? path.resolve(WORKSPACE, input.cwd) : WORKSPACE, timeout: 30000, maxBuffer: 1024*1024, encoding: 'utf-8', shell: true });
        return { type: 'text', text: output.slice(0, 30000) || '(no output)' };
      }
      case 'search_files': {
        try {
          const output = execSync(`grep -rn "${input.pattern.replace(/"/g, '\\"')}" --include="${input.glob||'*'}" "${path.resolve(WORKSPACE, input.path||'.')}" 2>/dev/null | head -50`, { encoding: 'utf-8', timeout: 10000, shell: true });
          return { type: 'text', text: output || 'No matches.' };
        } catch { return { type: 'text', text: 'No matches.' }; }
      }
      default: return { type: 'text', text: `Unknown tool: ${name}` };
    }
  } catch (e) { return { type: 'text', text: `Error: ${e.message}` }; }
}

function createClient(config) {
  const opts = {};
  opts.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (config.baseURL) opts.baseURL = config.baseURL;
  else if (process.env.ANTHROPIC_BASE_URL) opts.baseURL = process.env.ANTHROPIC_BASE_URL;
  return new Anthropic(opts);
}

expressApp.post('/api/chat', async (req, res) => {
  const { messages, system, config = {}, workspace: ws } = req.body;
  if (ws && fs.existsSync(ws)) WORKSPACE = ws;
  const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;

  if (!apiKey) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify({ type: 'error', error: '请先在设置中填写 API Key' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    return res.end();
  }

  const client = createClient(config);
  const model = config.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = d => res.write(`data: ${JSON.stringify(d)}\n\n`);

  try {
    let msgs = [...messages], loop = true;
    while (loop) {
      const stream = await client.messages.stream({
        model, max_tokens: 4096,
        system: system || 'You are Claude. You have tools for files, commands, and search. Respond in the user\'s language.',
        messages: msgs, tools,
      });

      let content = [];
      await new Promise(r => {
        stream.on('text', t => send({ type: 'text', text: t }));
        stream.on('message', m => { content = m.content; });
        stream.on('error', e => { send({ type: 'error', error: e.message }); loop = false; r(); });
        stream.on('end', () => r());
      });

      const toolBlocks = content.filter(b => b.type === 'tool_use');
      if (!toolBlocks.length) { loop = false; send({ type: 'done' }); }
      else {
        msgs.push({ role: 'assistant', content });
        const results = [];
        for (const tb of toolBlocks) {
          send({ type: 'tool_use', id: tb.id, name: tb.name, input: tb.input });
          const result = await executeTool(tb.name, tb.input);
          send({ type: 'tool_result', id: tb.id, name: tb.name, result: result.text });
          results.push({ type: 'tool_result', tool_use_id: tb.id, content: [result] });
        }
        msgs.push({ role: 'user', content: results });
      }
    }
  } catch (e) { send({ type: 'error', error: e.message }); send({ type: 'done' }); }
  finally { res.end(); }
});

expressApp.get('/api/workspace', (req, res) => res.json({ path: WORKSPACE }));
expressApp.post('/api/workspace', (req, res) => {
  const { path: p } = req.body;
  if (p && fs.existsSync(p)) { WORKSPACE = p; res.json({ ok: true, path: WORKSPACE }); }
  else res.status(400).json({ error: '目录不存在' });
});

expressApp.get('/api/workspace/files', (req, res) => {
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

const PORT = 3000;
let server, mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180, height: 720, minWidth: 800, minHeight: 500,
    frame: false, titleBarStyle: 'hidden', backgroundColor: '#ffffff',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  mainWindow.loadURL(`http://localhost:${PORT}`);
  ipcMain.on('window-close', () => mainWindow.close());
  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
  ipcMain.handle('select-directory', async (event, currentPath) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: currentPath || WORKSPACE,
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}

app.whenReady().then(() => {
  server = expressApp.listen(PORT, () => { console.log(`Claude Desktop on :${PORT}`); createWindow(); });
});
app.on('window-all-closed', () => { if (server) server.close(); app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
