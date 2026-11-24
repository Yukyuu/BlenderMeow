// Local Loopback Hub for Blender Meow Live Studio (shared by universal stdio MCP, Antigravity Sidecar & Pixel Meow handoff)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '..');
export const PIXELPAD_HUB_MODULE = path.resolve(REPO_ROOT, '..', 'PixelPad', 'mcp', 'hub.mjs');

export const HUB_VERSION = '1.4.5';
export const DEFAULT_HUB_PORT = Number(process.env.BLENDERMEOW_MCP_PORT || 17921);
export const HUB_STATE_DIR = path.join(os.homedir(), '.blendermeow-mcp');
export function getHubFilePath(customPath = '') {
  if (customPath) return path.resolve(customPath);
  if (process.env.BLENDERMEOW_MCP_HUB_FILE) {
    return path.resolve(process.env.BLENDERMEOW_MCP_HUB_FILE);
  }
  return path.join(HUB_STATE_DIR, 'hub.json');
}
export const HUB_FILE = getHubFilePath();
export const SNAPSHOT_DIR = path.join(HUB_STATE_DIR, 'snapshots');
export const FALLBACK_SAVE_DIR = path.join(os.homedir(), 'Documents', 'BlenderMeow');

export function toForwardSlashes(p) {
  return String(p || '').replace(/\\/g, '/');
}

export function fileUriToFsPath(uri) {
  if (!uri || typeof uri !== 'string') return null;
  const trimmed = uri.trim();
  if (!trimmed) return null;
  if (/^file:\/\//i.test(trimmed)) {
    try {
      let rest = trimmed.replace(/^file:\/\/\/?/i, '');
      rest = decodeURIComponent(rest);
      if (process.platform === 'win32') {
        rest = rest.replace(/\//g, '\\');
        if (/^[a-zA-Z]:/.test(rest)) {
          return path.resolve(rest);
        }
        return path.resolve('\\\\' + rest.replace(/^\\+/, ''));
      }
      return path.resolve('/' + rest.replace(/^\/+/, ''));
    } catch {
      return null;
    }
  }
  return path.resolve(trimmed);
}

function isLikelySystemDir(dirPath) {
  if (!dirPath) return true;
  const norm = toForwardSlashes(path.resolve(dirPath)).toLowerCase().replace(/\/+$/, '');
  const homeNorm = toForwardSlashes(path.resolve(os.homedir())).toLowerCase().replace(/\/+$/, '');
  if (norm === homeNorm || norm === '/' || /^[a-z]:$/.test(norm)) return true;
  if (
    norm.includes('/.gemini/') ||
    norm.endsWith('/.gemini') ||
    norm.includes('/appdata/') ||
    norm.includes('/program files') ||
    norm.includes('/windows/') ||
    norm.endsWith('/windows') ||
    norm.includes('/system32')
  ) {
    return true;
  }
  return false;
}

export function detectInitialWorkspaceRoot() {
  const envWs = String(process.env.BLENDERMEOW_WORKSPACE || process.env.PIXELMEOW_WORKSPACE || '').trim();
  if (envWs) {
    const resolvedEnv = fileUriToFsPath(envWs);
    try {
      if (resolvedEnv && fs.existsSync(resolvedEnv) && fs.statSync(resolvedEnv).isDirectory()) {
        return resolvedEnv;
      }
    } catch {
      // ignore invalid env path
    }
  }
  try {
    const cwd = path.resolve(process.cwd());
    if (!isLikelySystemDir(cwd) && fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()) {
      return cwd;
    }
  } catch {
    // ignore cwd errors
  }
  return null;
}

export function resolveSaveTarget({ workspaceRoot = null, customFolder = '', filename = 'model.psd' } = {}) {
  const safeName =
    path.basename(String(filename || 'model.psd')).replace(/[\\/:*?"<>|]/g, '_').trim() || 'model.psd';
  let baseDir = FALLBACK_SAVE_DIR;
  if (workspaceRoot) {
    try {
      const candidate = path.resolve(workspaceRoot);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        baseDir = candidate;
      }
    } catch {
      // fallback to Documents/BlenderMeow
    }
  }
  const rawFolder = String(customFolder ?? '').trim();
  let targetDir = baseDir;
  if (rawFolder && rawFolder !== '.') {
    targetDir = path.isAbsolute(rawFolder) ? path.resolve(rawFolder) : path.resolve(baseDir, rawFolder);
  }
  const fullPath = path.join(targetDir, safeName);
  return {
    targetDir,
    fullPath,
    displayDir: toForwardSlashes(targetDir),
    displayPath: toForwardSlashes(fullPath),
  };
}

export function saveBase64FileToDisk({
  workspaceRoot = null,
  customFolder = '',
  filename = 'model.psd',
  dataBase64 = '',
} = {}) {
  const buf = Buffer.from(String(dataBase64 || ''), 'base64');
  const { targetDir, fullPath, displayDir, displayPath } = resolveSaveTarget({
    workspaceRoot,
    customFolder,
    filename,
  });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(fullPath, buf);
  return {
    ok: true,
    savedPath: displayPath,
    dir: displayDir,
    bytes: buf.length,
  };
}

export function pickSystemFolderDialog({ initialDir = '' } = {}) {
  return new Promise((resolve) => {
    const validInit =
      initialDir && fs.existsSync(initialDir) ? path.resolve(initialDir) : '';

    if (process.platform === 'win32') {
      const escapedInit = validInit.replace(/'/g, "''");
      const psScript = [
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        'Add-Type -AssemblyName System.Windows.Forms',
        '$owner = New-Object System.Windows.Forms.Form',
        '$owner.TopMost = $true',
        '$owner.ShowInTaskbar = $false',
        '$owner.WindowState = [System.Windows.Forms.FormWindowState]::Minimized',
        '$dlg = New-Object System.Windows.Forms.FolderBrowserDialog',
        "$dlg.Description = 'Select Blender Meow Save Directory'",
        '$dlg.ShowNewFolderButton = $true',
        escapedInit ? `$dlg.SelectedPath = '${escapedInit}'` : '',
        'try {',
        '  $res = $dlg.ShowDialog($owner)',
        '  if ($res -eq [System.Windows.Forms.DialogResult]::OK -and $dlg.SelectedPath) {',
        '    [Console]::Out.Write($dlg.SelectedPath)',
        '  }',
        '} finally {',
        '  $dlg.Dispose()',
        '  $owner.Dispose()',
        '}',
      ]
        .filter(Boolean)
        .join('\n');
      const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
      const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });
      child.on('error', () => resolve({ ok: true, cancelled: true }));
      child.on('close', () => {
        const picked = stdout.trim();
        if (!picked) {
          resolve({ ok: true, cancelled: true });
          return;
        }
        const norm = toForwardSlashes(path.resolve(picked));
        resolve({ ok: true, cancelled: false, path: norm, name: norm });
      });
      return;
    }

    if (process.platform === 'darwin') {
      const child = spawn('osascript', ['-e', 'POSIX path of (choose folder)'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });
      child.on('error', () => resolve({ ok: true, cancelled: true }));
      child.on('close', (code) => {
        const picked = stdout.trim();
        if (code !== 0 || !picked) {
          resolve({ ok: true, cancelled: true });
          return;
        }
        const norm = toForwardSlashes(path.resolve(picked));
        resolve({ ok: true, cancelled: false, path: norm, name: norm });
      });
      return;
    }

    const args = ['--file-selection', '--directory'];
    if (validInit) args.push(`--filename=${validInit}/`);
    const child = spawn('zenity', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => resolve({ ok: true, cancelled: true }));
    child.on('close', (code) => {
      const picked = stdout.trim();
      if (code !== 0 || !picked) {
        resolve({ ok: true, cancelled: true });
        return;
      }
      const norm = toForwardSlashes(path.resolve(picked));
      resolve({ ok: true, cancelled: false, path: norm, name: norm });
    });
  });
}

export function ensureDirs() {
  fs.mkdirSync(HUB_STATE_DIR, { recursive: true });
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

let cachedHtml = null;

export function findStandaloneHtmlPath() {
  const candidates = [];
  const mcpBundle = path.join(REPO_ROOT, 'dist', 'blendermeow-mcp.html');
  if (fs.existsSync(mcpBundle)) {
    candidates.push({ full: mcpBundle, mtimeMs: fs.statSync(mcpBundle).mtimeMs });
  }
  const exact = path.join(REPO_ROOT, `BlenderMeow-v${HUB_VERSION}-Web.html`);
  if (fs.existsSync(exact)) {
    candidates.push({ full: exact, mtimeMs: fs.statSync(exact).mtimeMs });
  }
  if (fs.existsSync(REPO_ROOT)) {
    for (const name of fs.readdirSync(REPO_ROOT)) {
      if (/^BlenderMeow-v.*-Web\.html$/i.test(name)) {
        const full = path.join(REPO_ROOT, name);
        candidates.push({ full, mtimeMs: fs.statSync(full).mtimeMs });
      }
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (candidates.length > 0) return candidates[0].full;

  const distHtml = path.join(REPO_ROOT, 'dist', 'index.html');
  if (fs.existsSync(distHtml)) return distHtml;
  return null;
}

export function getBlenderMeowHtml({ apiBase = '/api/mcp', extraHead = '' } = {}) {
  const htmlPath = findStandaloneHtmlPath();
  if (!htmlPath) {
    return [
      '<!doctype html><html><body style="background:#1e1e22;color:#ececf1;font-family:sans-serif;padding:24px">',
      '<h2>Blender Meow MCP Web bundle not built yet</h2>',
      `<p>Run <code>npm run build:mcp</code> inside <code>${REPO_ROOT}</code> first.</p>`,
      '</body></html>',
    ].join('');
  }
  const st = fs.statSync(htmlPath);
  if (!cachedHtml || cachedHtml.path !== htmlPath || cachedHtml.mtimeMs !== st.mtimeMs) {
    cachedHtml = {
      path: htmlPath,
      mtimeMs: st.mtimeMs,
      raw: fs.readFileSync(htmlPath, 'utf8'),
    };
  }
  const injection = [
    extraHead,
    `<script>window.__BLENDERMEOW_MCP_ENABLED__=true;window.__BLENDERMEOW_MCP_API__=${JSON.stringify(apiBase)};</script>`,
  ].filter(Boolean).join('\n');

  const raw = cachedHtml.raw;
  const idx = raw.search(/<\/head>/i);
  if (idx >= 0) {
    return raw.slice(0, idx) + '\n' + injection + '\n' + raw.slice(idx);
  }
  return injection + '\n' + raw;
}

export function launchBrowserAppWindow(url) {
  try {
    if (process.platform === 'win32') {
      const localApp = process.env.LOCALAPPDATA || '';
      const browserCandidates = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        localApp ? path.join(localApp, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
        'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      ].filter(Boolean);

      for (const exe of browserCandidates) {
        if (fs.existsSync(exe)) {
          const child = spawn(exe, [`--app=${url}`, '--window-size=1280,860'], {
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
          return { launched: true, mode: 'app-window', executable: exe };
        }
      }

      const child = spawn('cmd.exe', ['/c', 'start', '""', url], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return { launched: true, mode: 'default-browser' };
    }

    if (process.platform === 'darwin') {
      const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      if (fs.existsSync(chromePath)) {
        const child = spawn(chromePath, [`--app=${url}`, '--window-size=1280,860'], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        return { launched: true, mode: 'app-window', executable: chromePath };
      }
      const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
      return { launched: true, mode: 'default-browser' };
    }

    for (const bin of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      try {
        const child = spawn(bin, [`--app=${url}`, '--window-size=1280,860'], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        return { launched: true, mode: 'app-window', executable: bin };
      } catch {
        // try next binary
      }
    }
    return { launched: false, mode: 'none' };
  } catch (err) {
    return { launched: false, mode: 'error', error: String(err) };
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

function sendJson(res, status, obj) {
  const payload = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  res.end(payload);
}

async function probePixelMeowHealth(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/mcp/health`, {
      signal: AbortSignal.timeout(1200),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ok ? data : null;
  } catch {
    return null;
  }
}

export async function handoffToPixelMeowHub(opts = {}) {
  const pmHubFile = opts.pixelMeowHubFile
    ? path.resolve(String(opts.pixelMeowHubFile))
    : process.env.PIXELMEOW_MCP_HUB_FILE
      ? path.resolve(process.env.PIXELMEOW_MCP_HUB_FILE)
      : path.join(os.homedir(), '.pixelmeow-mcp', 'hub.json');

  const candidatePorts = [];
  if (typeof opts.pixelMeowPort === 'number' && opts.pixelMeowPort > 0) {
    candidatePorts.push(opts.pixelMeowPort);
  }
  if (fs.existsSync(pmHubFile)) {
    try {
      const info = JSON.parse(fs.readFileSync(pmHubFile, 'utf8'));
      if (info && typeof info.port === 'number' && !candidatePorts.includes(info.port)) {
        candidatePorts.push(info.port);
      }
    } catch {
      // ignore invalid hub.json
    }
  }
  const fallbackPmPort = Number(process.env.PIXELMEOW_MCP_PORT || 17920);
  if (!candidatePorts.includes(fallbackPmPort)) candidatePorts.push(fallbackPmPort);

  let pmPort = 0;
  let pmHealth = null;
  for (const p of candidatePorts) {
    const h = await probePixelMeowHealth(p);
    if (h) {
      pmPort = p;
      pmHealth = h;
      break;
    }
  }

  if (!pmPort && fs.existsSync(PIXELPAD_HUB_MODULE)) {
    const pmMod = await import(pathToFileURL(PIXELPAD_HUB_MODULE).href);
    const pmHub = await pmMod.ensureHubRunning({
      autoOpenAllowed: opts.autoOpenPixelMeow !== false,
    });
    pmPort = pmHub.port;
    pmHealth = await probePixelMeowHealth(pmPort);
  }

  if (!pmPort) {
    return {
      ok: false,
      error: '未找到正在运行的 Pixel Meow MCP Hub，请先打开 Pixel Meow 画板或启用 pixel-meow 插件。',
    };
  }

  const autoOpen = opts.autoOpenPixelMeow !== false;
  if ((!pmHealth || !pmHealth.hasLiveCanvas) && autoOpen) {
    await forwardToHub(pmPort, '/open', 'POST', { autoOpen: true }, 15000).catch(() => {});
  }

  const format = String(opts.format || 'psd').toLowerCase() === 'png' ? 'png' : 'psd';
  const importMode = opts.importMode === 'as_layer' ? 'as_layer' : 'new_project';
  const command = format === 'png'
    ? {
        kind: 'doc_action',
        action: 'import_png_base64',
        pngBase64: String(opts.dataBase64 || ''),
        x: Math.round(Number(opts.x) || 0),
        y: Math.round(Number(opts.y) || 0),
        asNewLayer: opts.importMode !== 'replace_active',
        layerName: String(opts.layerName || opts.projectName || 'Blender Meow 导入图层'),
      }
    : {
        kind: 'doc_action',
        action: 'import_psd_base64',
        psdBase64: String(opts.dataBase64 || ''),
        docName: String(opts.projectName || 'Blender Meow 建模'),
        asNewLayer: importMode === 'as_layer',
      };

  const execRes = await forwardToHub(pmPort, '/exec', 'POST', {
    command,
    autoOpen,
    timeoutMs: Number(opts.timeoutMs) || 30000,
  }, 35000);

  if (execRes.status >= 400 || !execRes.data?.ok) {
    return {
      ok: false,
      pixelMeowPort: pmPort,
      error: execRes.data?.error || `Pixel Meow 导入失败 (HTTP ${execRes.status})`,
    };
  }

  const modeLabel = format === 'png'
    ? (opts.importMode === 'replace_active' ? '覆盖到 Pixel Meow 当前图层' : '导入为 Pixel Meow 新图层')
    : (importMode === 'as_layer' ? '作为分层合并到 Pixel Meow 当前画布' : '在 Pixel Meow 中打开为新多图层项目');

  return {
    ok: true,
    format,
    importMode,
    pixelMeowPort: pmPort,
    pixelMeowUrl: pmHealth?.url || `http://127.0.0.1:${pmPort}/?mcp=1`,
    pixelMeowSidecarLink: '[Pixel Meow 画板](sidecar://pixel-meow/pixel_canvas/ui.html)',
    message: `🐱 已无缝传入 Pixel Meow（${modeLabel}）`,
    result: execRes.data.result ?? execRes.data,
  };
}

export async function startHubServer({
  port = DEFAULT_HUB_PORT,
  autoOpenAllowed = true,
  hubFile = HUB_FILE,
} = {}) {
  ensureDirs();
  const activeHubFile = hubFile ? path.resolve(hubFile) : HUB_FILE;
  fs.mkdirSync(path.dirname(activeHubFile), { recursive: true });

  const clients = new Map(); // clientId -> { lastSeen, pollWaiter, hasPolled }
  const pendingJobs = [];
  const inflightJobs = new Map();
  let latestState = null;
  let lastLaunchAt = 0;
  let activeWorkspaceRoot = detectInitialWorkspaceRoot();

  function ingestWorkspaceUris(uris) {
    if (!Array.isArray(uris)) return;
    for (const u of uris) {
      const p = fileUriToFsPath(u);
      try {
        if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) {
          activeWorkspaceRoot = p;
          return;
        }
      } catch {
        // try next URI
      }
    }
  }

  function getDefaultSaveDir() {
    return activeWorkspaceRoot && fs.existsSync(activeWorkspaceRoot)
      ? activeWorkspaceRoot
      : FALLBACK_SAVE_DIR;
  }

  function pruneStaleClients() {
    const now = Date.now();
    for (const [id, c] of clients.entries()) {
      if (now - c.lastSeen > 45000 && !c.pollWaiter) {
        clients.delete(id);
      }
    }
  }

  function hasLiveClient() {
    pruneStaleClients();
    for (const c of clients.values()) {
      if (c.hasPolled && Date.now() - c.lastSeen < 35000) return true;
    }
    return false;
  }

  function waitForLiveClient(timeoutMs = 15000) {
    if (hasLiveClient()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const start = Date.now();
      const iv = setInterval(() => {
        if (hasLiveClient()) {
          clearInterval(iv);
          resolve(true);
        } else if (Date.now() - start >= timeoutMs) {
          clearInterval(iv);
          resolve(false);
        }
      }, 150);
    });
  }

  function touchClient(clientId, markPolled = false) {
    let c = clients.get(clientId);
    if (!c) {
      c = { lastSeen: Date.now(), pollWaiter: null, hasPolled: false };
      clients.set(clientId, c);
    }
    c.lastSeen = Date.now();
    if (markPolled) c.hasPolled = true;
    return c;
  }

  function dispatchPending() {
    pruneStaleClients();
    for (let i = 0; i < pendingJobs.length; i++) {
      const job = pendingJobs[i];
      let chosen = null;
      if (job.targetClientId) {
        const target = clients.get(job.targetClientId);
        if (target && target.pollWaiter) chosen = target;
      }
      if (!chosen) {
        let bestSeen = -1;
        for (const c of clients.values()) {
          if (c.pollWaiter && c.lastSeen > bestSeen) {
            chosen = c;
            bestSeen = c.lastSeen;
          }
        }
      }
      if (chosen && chosen.pollWaiter) {
        pendingJobs.splice(i, 1);
        i--;
        inflightJobs.set(job.reqId, job);
        const wake = chosen.pollWaiter;
        chosen.pollWaiter = null;
        wake({ reqId: job.reqId, command: job.command });
      }
    }
  }

  function execCommandOnCanvas(command, { autoOpen = true, timeoutMs = 30000 } = {}) {
    return new Promise((resolve, reject) => {
      (async () => {
        if (!hasLiveClient()) {
          if (autoOpen && autoOpenAllowed && Date.now() - lastLaunchAt > 4000) {
            lastLaunchAt = Date.now();
            const addr = server.address();
            const actualPort = typeof addr === 'object' && addr ? addr.port : port;
            launchBrowserAppWindow(`http://127.0.0.1:${actualPort}/?mcp=1`);
          }
          const connected = await waitForLiveClient(Math.min(timeoutMs, 15000));
          if (!connected && !hasLiveClient()) {
            const addr = server.address();
            const actualPort = typeof addr === 'object' && addr ? addr.port : port;
            reject(
              new Error(
                `No live Blender Meow studio connected yet. Open http://127.0.0.1:${actualPort}/?mcp=1 or open the Antigravity Blender Meow Sidecar panel, then retry.`,
              ),
            );
            return;
          }
        }

        const reqId = `bm_job_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
        const timer = setTimeout(() => {
          const pIdx = pendingJobs.findIndex((j) => j.reqId === reqId);
          if (pIdx >= 0) pendingJobs.splice(pIdx, 1);
          inflightJobs.delete(reqId);
          reject(new Error(`Blender Meow command "${command?.kind}" timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        pendingJobs.push({
          reqId,
          command,
          enqueuedAt: Date.now(),
          targetClientId: typeof command?.targetClientId === 'string' ? command.targetClientId : null,
          resolve,
          reject,
          timer,
        });
        dispatchPending();
      })().catch(reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = reqUrl.pathname;

      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html' || pathname === '/ui.html')) {
        const html = getBlenderMeowHtml({ apiBase: '/api/mcp' });
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.end(html);
        return;
      }

      if (req.method === 'GET' && pathname === '/api/mcp/health') {
        pruneStaleClients();
        const addr = server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        sendJson(res, 200, {
          ok: true,
          version: HUB_VERSION,
          pid: process.pid,
          port: actualPort,
          url: `http://127.0.0.1:${actualPort}/?mcp=1`,
          connectedClients: clients.size,
          hasLiveCanvas: hasLiveClient(),
          workspaceRoot: activeWorkspaceRoot ? toForwardSlashes(activeWorkspaceRoot) : null,
          defaultSaveDir: toForwardSlashes(getDefaultSaveDir()),
          latestState,
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/mcp/poll') {
        const clientId = reqUrl.searchParams.get('clientId') || 'default';
        const client = touchClient(clientId, true);

        if (client.pollWaiter) {
          const prevWake = client.pollWaiter;
          client.pollWaiter = null;
          prevWake({ noop: true });
        }

        const jobIdx = pendingJobs.findIndex(
          (j) => !j.targetClientId || j.targetClientId === client.id || !clients.get(j.targetClientId)?.hasPolled,
        );
        if (jobIdx >= 0) {
          const [job] = pendingJobs.splice(jobIdx, 1);
          inflightJobs.set(job.reqId, job);
          sendJson(res, 200, { reqId: job.reqId, command: job.command });
          return;
        }

        const waitTimer = setTimeout(() => {
          if (client.pollWaiter === finish) {
            client.pollWaiter = null;
          }
          if (!res.writableEnded) sendJson(res, 200, { noop: true });
        }, 5000);

        function finish(payload) {
          clearTimeout(waitTimer);
          if (!res.writableEnded) sendJson(res, 200, payload);
        }

        req.on('close', () => {
          clearTimeout(waitTimer);
          if (client.pollWaiter === finish) {
            client.pollWaiter = null;
          }
        });

        client.pollWaiter = finish;
        return;
      }

      if (req.method === 'POST' && pathname === '/api/mcp/result') {
        const body = await readJsonBody(req);
        if (body.clientId) touchClient(body.clientId);
        if (body.state) latestState = body.state;
        const job = inflightJobs.get(body.reqId);
        if (job) {
          inflightJobs.delete(body.reqId);
          clearTimeout(job.timer);
          if (body.ok) {
            job.resolve({ ok: true, result: body.result ?? {}, state: body.state ?? latestState });
          } else {
            job.reject(new Error(String(body.error || 'Studio command failed')));
          }
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/mcp/sync') {
        const body = await readJsonBody(req);
        if (body.clientId) touchClient(body.clientId);
        if (body.state) latestState = body.state;
        ingestWorkspaceUris(body.workspaceUris);
        sendJson(res, 200, {
          ok: true,
          workspaceRoot: activeWorkspaceRoot ? toForwardSlashes(activeWorkspaceRoot) : null,
          defaultSaveDir: toForwardSlashes(getDefaultSaveDir()),
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/mcp/save_file') {
        const body = await readJsonBody(req);
        ingestWorkspaceUris(body.workspaceUris);
        if (typeof body.dataBase64 !== 'string') {
          sendJson(res, 400, { ok: false, error: 'Missing dataBase64 string' });
          return;
        }
        const saved = saveBase64FileToDisk({
          workspaceRoot: activeWorkspaceRoot,
          customFolder: typeof body.folder === 'string' ? body.folder : '',
          filename: typeof body.filename === 'string' ? body.filename : 'model.psd',
          dataBase64: body.dataBase64,
        });
        sendJson(res, 200, saved);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/mcp/pick_folder') {
        const body = await readJsonBody(req);
        ingestWorkspaceUris(body.workspaceUris);
        const requestedInit = typeof body.initialDir === 'string' ? fileUriToFsPath(body.initialDir) : null;
        const startDir =
          requestedInit && fs.existsSync(requestedInit) ? requestedInit : getDefaultSaveDir();
        const picked = await pickSystemFolderDialog({ initialDir: startDir });
        sendJson(res, 200, picked);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/mcp/handoff_pixelmeow') {
        const body = await readJsonBody(req);
        ingestWorkspaceUris(body.workspaceUris);
        const out = await handoffToPixelMeowHub(body);
        sendJson(res, out.ok ? 200 : 502, out);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/mcp/exec') {
        const body = await readJsonBody(req);
        if (!body || typeof body.command !== 'object') {
          sendJson(res, 400, { ok: false, error: 'Missing command object' });
          return;
        }
        try {
          const out = await execCommandOnCanvas(body.command, {
            autoOpen: body.autoOpen !== false,
            timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : 30000,
          });
          sendJson(res, 200, out);
        } catch (err) {
          sendJson(res, 502, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/mcp/open') {
        const body = await readJsonBody(req);
        const addr = server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        const url = `http://127.0.0.1:${actualPort}/?mcp=1`;
        let launchInfo = { launched: false, mode: 'already-live' };
        if (!hasLiveClient() && body.autoOpen !== false && autoOpenAllowed) {
          launchInfo = launchBrowserAppWindow(url);
          await waitForLiveClient(12000);
        }
        sendJson(res, 200, {
          ok: true,
          url,
          hasLiveCanvas: hasLiveClient(),
          launchInfo,
          latestState,
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    } catch (err) {
      if (!res.writableEnded) {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err && err.code === 'EADDRINUSE' && port !== 0) {
        server.removeListener('error', onError);
        server.listen(0, '127.0.0.1', resolve);
        return;
      }
      reject(err);
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve();
    });
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = `http://127.0.0.1:${actualPort}/?mcp=1`;
  const hubInfo = {
    host: '127.0.0.1',
    port: actualPort,
    url,
    pid: process.pid,
    version: HUB_VERSION,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(activeHubFile, JSON.stringify(hubInfo, null, 2), 'utf8');

  const cleanupHubFile = () => {
    try {
      if (fs.existsSync(activeHubFile)) {
        const cur = JSON.parse(fs.readFileSync(activeHubFile, 'utf8'));
        if (cur && cur.pid === process.pid) {
          fs.rmSync(activeHubFile, { force: true });
        }
      }
    } catch {
      // ignore cleanup error
    }
  };

  return {
    ...hubInfo,
    ownsServer: true,
    waitForLiveClient,
    execCommandOnCanvas,
    close: () =>
      new Promise((resolve) => {
        cleanupHubFile();
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        server.close(() => resolve());
      }),
    cleanupHubFile,
  };
}

async function probeHubHealth(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/mcp/health`, {
      signal: AbortSignal.timeout(1200),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.ok && data.version === HUB_VERSION) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export async function ensureHubRunning({
  port = DEFAULT_HUB_PORT,
  autoOpenAllowed = true,
  hubFile = HUB_FILE,
} = {}) {
  const activeHubFile = hubFile ? path.resolve(hubFile) : HUB_FILE;
  if (port !== 0 && fs.existsSync(activeHubFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(activeHubFile, 'utf8'));
      if (existing && typeof existing.port === 'number') {
        const health = await probeHubHealth(existing.port);
        if (health) {
          return {
            host: '127.0.0.1',
            port: existing.port,
            url: existing.url || `http://127.0.0.1:${existing.port}/?mcp=1`,
            version: health.version,
            ownsServer: false,
            hasLiveCanvas: Boolean(health.hasLiveCanvas),
          };
        }
      }
    } catch {
      // stale hub file
    }
  }

  if (port !== 0) {
    const healthOnDefault = await probeHubHealth(port);
    if (healthOnDefault) {
      return {
        host: '127.0.0.1',
        port,
        url: `http://127.0.0.1:${port}/?mcp=1`,
        version: healthOnDefault.version,
        ownsServer: false,
        hasLiveCanvas: Boolean(healthOnDefault.hasLiveCanvas),
      };
    }
  }

  return await startHubServer({ port, autoOpenAllowed, hubFile: activeHubFile });
}

export async function forwardToHub(port, apiPath, method = 'GET', bodyObj = null, timeoutMs = 35000) {
  const normalized = apiPath.startsWith('/api/mcp') ? apiPath : `/api/mcp${apiPath.startsWith('/') ? '' : '/'}${apiPath}`;
  const res = await fetch(`http://127.0.0.1:${port}${normalized}`, {
    method,
    headers: bodyObj ? { 'Content-Type': 'application/json' } : undefined,
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  const hub = await ensureHubRunning({ port: DEFAULT_HUB_PORT, autoOpenAllowed: true });
  console.log(JSON.stringify({ ok: true, ...hub }));
  if (hub.ownsServer) {
    const cleanExit = async () => {
      await hub.close();
      process.exit(0);
    };
    process.on('SIGINT', cleanExit);
    process.on('SIGTERM', cleanExit);
  }
}
