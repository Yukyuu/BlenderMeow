// Browser-side MCP Live Studio Bridge (activates only when ?mcp=1 or Sidecar MCP flag is set)
import { executeAiStudioCommand, getStudioState, type AiStudioContext } from './core/aiStudioOps';
import { h } from './ui/dom';

declare global {
  interface Window {
    __BLENDERMEOW_MCP_ENABLED__?: boolean;
    __BLENDERMEOW_MCP_API__?: string;
    sidecar?: {
      fetch?: (url: string, options?: RequestInit) => Promise<Response>;
      getWorkspaceUris?: () => Promise<string[]>;
      onWorkspaceChange?: (listener: (uris: string[]) => void) => () => void;
    };
  }
}

type BridgeFetchFn = (path: string, init?: RequestInit) => Promise<Response>;

let activeBridgeFetch: BridgeFetchFn | null = null;
let currentWorkspaceUris: string[] = [];
let resolvedDefaultSaveDir = '';
let customFolderGetter: () => string = () => '';

function decodeFileUriForDisplay(uri: string): string {
  if (!uri) return '';
  let s = uri.trim();
  if (/^file:\/\//i.test(s)) {
    try {
      s = decodeURIComponent(s.replace(/^file:\/\/\/?/i, ''));
    } catch {
      s = s.replace(/^file:\/\/\/?/i, '');
    }
    s = s.replace(/\\/g, '/');
    if (!/^[a-zA-Z]:/.test(s) && !s.startsWith('/')) {
      s = '/' + s;
    }
  } else {
    s = s.replace(/\\/g, '/');
  }
  return s.replace(/\/+$/, '');
}

export function shouldEnableMcpBridge(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.__BLENDERMEOW_MCP_ENABLED__ === true) return true;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('mcp') === '1';
  } catch {
    return false;
  }
}

export function isMcpBridgeActive(): boolean {
  return activeBridgeFetch !== null || shouldEnableMcpBridge();
}

export function getMcpDefaultSaveDir(): string {
  if (resolvedDefaultSaveDir) return resolvedDefaultSaveDir;
  if (currentWorkspaceUris.length > 0) {
    const decoded = decodeFileUriForDisplay(currentWorkspaceUris[0]);
    if (decoded) return decoded;
  }
  return '当前工作区';
}

function getBridgeFetch(): BridgeFetchFn {
  if (activeBridgeFetch) return activeBridgeFetch;
  const apiBase = (window.__BLENDERMEOW_MCP_API__ || '/api/mcp').replace(/\/+$/, '');
  return (path: string, init?: RequestInit) => {
    const url = `${apiBase}${path}`;
    const sc = window.sidecar;
    if (sc && typeof sc.fetch === 'function') {
      return sc.fetch(url, init);
    }
    return window.fetch(url, init);
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureWorkspaceUris(): Promise<void> {
  if (currentWorkspaceUris.length > 0) return;
  if (typeof window !== 'undefined' && window.sidecar && typeof window.sidecar.getWorkspaceUris === 'function') {
    try {
      const uris = await Promise.race([
        window.sidecar.getWorkspaceUris(),
        sleep(500).then(() => [] as string[]),
      ]);
      if (Array.isArray(uris) && uris.length > 0) {
        currentWorkspaceUris = uris;
      }
    } catch {
      // ignore timeout
    }
  }
}

export async function mcpSaveFileToDisk(
  filename: string,
  dataBase64: string,
  folder?: string,
): Promise<{ savedPath: string; dir: string; bytes?: number }> {
  const fetcher = getBridgeFetch();
  await ensureWorkspaceUris();
  const res = await fetcher('/save_file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename,
      dataBase64,
      folder: folder ?? customFolderGetter(),
      workspaceUris: currentWorkspaceUris,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    savedPath?: string;
    dir?: string;
    bytes?: number;
    error?: string;
  };
  if (!res.ok || !data.savedPath) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  if (data.dir && !customFolderGetter()) {
    resolvedDefaultSaveDir = data.dir;
  }
  return { savedPath: data.savedPath, dir: data.dir || '', bytes: data.bytes };
}

export async function mcpPickFolderDialog(
  initialDir?: string,
): Promise<{ uri: string; name: string } | null> {
  const fetcher = getBridgeFetch();
  await ensureWorkspaceUris();
  const res = await fetcher('/pick_folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      initialDir: initialDir || getMcpDefaultSaveDir(),
      workspaceUris: currentWorkspaceUris,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    cancelled?: boolean;
    path?: string;
    name?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  if (data.cancelled || !data.path) return null;
  return { uri: data.path, name: data.name || data.path };
}

export async function mcpHandoffToPixelMeow(payload: {
  format: 'psd' | 'png';
  dataBase64: string;
  filename: string;
  projectName: string;
  importMode: 'new_project' | 'as_layer';
  layerName?: string;
  autoOpenPixelMeow?: boolean;
}): Promise<{ ok: boolean; message: string; pixelMeowSidecarLink?: string }> {
  const fetcher = getBridgeFetch();
  await ensureWorkspaceUris();
  try {
    const res = await fetcher('/handoff_pixelmeow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        workspaceUris: currentWorkspaceUris,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      message?: string;
      pixelMeowSidecarLink?: string;
    };
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        message: data.error || data.message || `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      message: data.message || '🐱 已直接导入 Pixel Meow 画布！',
      pixelMeowSidecarLink: data.pixelMeowSidecarLink,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function makeClientId(): string {
  return 'bm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

export function initMcpBridge(ctx: AiStudioContext, statusMount?: HTMLElement): () => void {
  const apiBase = (window.__BLENDERMEOW_MCP_API__ || '/api/mcp').replace(/\/+$/, '');
  const clientId = makeClientId();
  let stopped = false;
  let syncTimer = 0;

  const pill = h('span', {
    class: 'mcp-status-pill connecting',
    title: 'Blender Meow AI MCP Live Studio Bridge',
  }, '🤖 AI 桥接中');
  if (statusMount) {
    statusMount.appendChild(pill);
  }

  function setPillState(mode: 'live' | 'connecting' | 'retrying') {
    pill.classList.remove('live', 'connecting', 'retrying');
    pill.classList.add(mode);
    if (mode === 'live') pill.textContent = '🤖 AI 已连接';
    else if (mode === 'connecting') pill.textContent = '🤖 AI 桥接中';
    else pill.textContent = '🤖 AI 重连中';
  }

  async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${apiBase}${path}`;
    const sc = window.sidecar;
    if (sc && typeof sc.fetch === 'function') {
      return sc.fetch(url, init);
    }
    return window.fetch(url, init);
  }

  activeBridgeFetch = apiFetch;
  customFolderGetter = () => ctx.app.settings.exportPath || '';

  let unsubWorkspace: (() => void) | null = null;
  if (window.sidecar && typeof window.sidecar.onWorkspaceChange === 'function') {
    unsubWorkspace = window.sidecar.onWorkspaceChange((uris) => {
      if (Array.isArray(uris)) {
        currentWorkspaceUris = uris;
        const decoded = uris.length > 0 ? decodeFileUriForDisplay(uris[0]) : '';
        if (decoded) resolvedDefaultSaveDir = decoded;
        scheduleSync();
      }
    });
  }

  async function pushSync() {
    if (stopped) return;
    try {
      const res = await apiFetch('/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          workspaceUris: currentWorkspaceUris,
          state: getStudioState(ctx.app),
        }),
      });
      if (res.ok) {
        setPillState('live');
        try {
          const data = (await res.json()) as { workspaceRoot?: string | null; defaultSaveDir?: string | null };
          if (data?.defaultSaveDir) resolvedDefaultSaveDir = data.defaultSaveDir;
          else if (data?.workspaceRoot) resolvedDefaultSaveDir = data.workspaceRoot;
        } catch {
          // ignore non-json sync reply
        }
      }
    } catch {
      // retry in poll loop
    }
  }

  function scheduleSync() {
    if (stopped) return;
    if (syncTimer) window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      syncTimer = 0;
      void pushSync();
    }, 250);
  }

  const unsubApp = ctx.app.on((what) => {
    if (what === 'doc' || what === 'layers' || what === 'history') {
      scheduleSync();
    }
  });

  async function pollLoop() {
    await ensureWorkspaceUris();
    await pushSync();
    let failCount = 0;
    while (!stopped) {
      try {
        const res = await apiFetch(`/poll?clientId=${encodeURIComponent(clientId)}`, {
          method: 'GET',
        });
        if (!res.ok) {
          failCount++;
          setPillState('retrying');
          await sleep(Math.min(3000, 400 * failCount));
          continue;
        }
        failCount = 0;
        setPillState('live');
        const msg = (await res.json()) as {
          noop?: boolean;
          reqId?: string;
          command?: Record<string, unknown>;
        };
        if (!msg || msg.noop || !msg.reqId || !msg.command) {
          continue;
        }

        let ok = true;
        let result: unknown = null;
        let errorMsg = '';
        try {
          result = await executeAiStudioCommand(ctx, msg.command);
        } catch (err) {
          ok = false;
          errorMsg = err instanceof Error ? err.message : String(err);
        }

        await apiFetch('/result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            reqId: msg.reqId,
            ok,
            result,
            error: errorMsg,
            state: getStudioState(ctx.app),
          }),
        });
      } catch {
        if (stopped) break;
        failCount++;
        setPillState('retrying');
        await sleep(Math.min(3000, 500 * failCount));
      }
    }
  }

  void pollLoop();

  return () => {
    stopped = true;
    activeBridgeFetch = null;
    if (syncTimer) window.clearTimeout(syncTimer);
    if (unsubWorkspace) unsubWorkspace();
    unsubApp();
    pill.remove();
  };
}
