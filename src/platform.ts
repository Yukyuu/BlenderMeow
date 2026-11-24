// Platform helpers: IndexedDB storage, SAF file save/pick, and Android/Web/MCP handoff bridge to Pixel Meow
import { Capacitor, registerPlugin } from '@capacitor/core';
import { PIXEL_MEOW_ONLINE_URL } from './core/about';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
  isMcpBridgeActive,
  mcpHandoffToPixelMeow,
  mcpPickFolderDialog,
  mcpSaveFileToDisk,
} from './mcpBridge';

export const isNative = () => Capacitor.isNativePlatform();

interface DocumentPickerPlugin {
  pick(opts: { mode?: 'document' | 'gallery'; mimeTypes?: string[] }): Promise<{
    cancelled?: boolean;
    name?: string;
    mimeType?: string;
    data?: string;
  }>;
  pickFolder(): Promise<{
    cancelled?: boolean;
    uri?: string;
    name?: string;
  }>;
  saveToTree(opts: {
    treeUri: string;
    filename: string;
    mimeType: string;
    data: string;
  }): Promise<{ uri: string }>;
}

const DocumentPicker = registerPlugin<DocumentPickerPlugin>('DocumentPicker');

interface MeowBridgePlugin {
  beginHandoff(opts: { filename: string }): Promise<{ handoffId: string }>;
  appendHandoffChunk(opts: { handoffId: string; chunk: string }): Promise<{ ok: boolean }>;
  cancelHandoff(opts: { handoffId: string }): Promise<void>;
  commitAndLaunchPixelMeow(opts: {
    handoffId: string;
    filename: string;
    mimeType: string;
    importMode: 'new_project' | 'as_layer';
    projectName: string;
  }): Promise<{ launched: boolean; reason?: string }>;
}

const MeowBridge = registerPlugin<MeowBridgePlugin>('MeowBridge');

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const sliceSize = 0x8000;
  for (let i = 0; i < bytes.length; i += sliceSize) {
    const sub = bytes.subarray(i, Math.min(bytes.length, i + sliceSize));
    bin += String.fromCharCode(...sub);
  }
  return btoa(bin);
}

let cachedPixelMeowWin: Window | null = null;
let cachedPixelMeowOrigin = '';

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

function base64ToFile(b64: string, name: string, mime: string): File {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type: mime });
}

export interface SaveFileOptions {
  folder?: string;
  treeUri?: string;
  share?: boolean;
}

export async function pickFolder(): Promise<{ uri: string; name: string } | null> {
  if (!isNative()) {
    if (isMcpBridgeActive()) {
      try {
        return await mcpPickFolderDialog();
      } catch (e) {
        console.warn('mcpPickFolderDialog failed', e);
      }
    }
    return null;
  }
  try {
    const r = await DocumentPicker.pickFolder();
    if (r.cancelled || !r.uri) return null;
    return { uri: r.uri, name: r.name || r.uri };
  } catch (e) {
    console.warn('pickFolder failed', e);
    return null;
  }
}

export async function saveFile(blob: Blob, filename: string, opts: boolean | SaveFileOptions = true): Promise<string> {
  const share = typeof opts === 'boolean' ? opts : (opts.share ?? false);
  const folder = (typeof opts === 'object' && opts.folder ? opts.folder : 'BlenderMeow').replace(/^[/\\]+|[/\\]+$/g, '') || 'BlenderMeow';
  const treeUri = typeof opts === 'object' ? opts.treeUri : undefined;

  if (!isNative()) {
    if (isMcpBridgeActive()) {
      try {
        const b64 = await blobToBase64(blob);
        const saved = await mcpSaveFileToDisk(
          filename,
          b64,
          typeof opts === 'object' ? opts.folder : undefined,
        );
        return `已保存至 ${saved.savedPath}`;
      } catch (e) {
        console.warn('MCP workspace save failed, fallback to browser download', e);
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return `已下载 ${filename}`;
  }

  const data = await blobToBase64(blob);
  let savedPath = '';

  if (treeUri) {
    try {
      await DocumentPicker.saveToTree({
        treeUri,
        filename,
        mimeType: blob.type || 'application/octet-stream',
        data,
      });
      savedPath = `${folder}/${filename}`;
      if (!share) return `已保存至 ${savedPath}`;
    } catch (e) {
      console.warn('SAF tree write failed, fallback to Documents', e);
    }
  }

  if (!savedPath) {
    try {
      await Filesystem.writeFile({
        path: `${folder}/${filename}`,
        data,
        directory: Directory.Documents,
        recursive: true,
      });
      savedPath = `Documents/${folder}/${filename}`;
      if (!share) return `已保存至 ${savedPath}`;
    } catch (e) {
      console.warn('Documents write failed, fallback to cache', e);
    }
  }

  const c = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache, recursive: true });
  try {
    await Share.share({ title: filename, files: [c.uri], dialogTitle: `保存 / 分享 ${filename}` });
  } catch { /* cancelled */ }
  return savedPath ? `已保存至 ${savedPath}` : `已导出 ${filename}`;
}

export interface HandoffResult {
  ok: boolean;
  channel: 'android-intent' | 'web-broadcast' | 'web-window' | 'fallback-share';
  message: string;
}

export async function sendToPixelMeowApp(
  blob: Blob,
  filename: string,
  importMode: 'new_project' | 'as_layer',
  projectName: string,
  opts: { pixelMeowWebUrl: string; exportPath: string; exportTreeUri?: string },
): Promise<HandoffResult> {
  const mimeType = blob.type || (filename.endsWith('.psd') ? 'image/vnd.adobe.photoshop' : 'image/png');

  if (isNative()) {
    let handoffId = '';
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const begun = await MeowBridge.beginHandoff({ filename });
      handoffId = begun.handoffId;
      const chunkBytes = 256 * 1024;
      for (let off = 0; off < bytes.length; off += chunkBytes) {
        const sub = bytes.subarray(off, Math.min(bytes.length, off + chunkBytes));
        await MeowBridge.appendHandoffChunk({
          handoffId,
          chunk: bytesToBase64(sub),
        });
      }
      const res = await MeowBridge.commitAndLaunchPixelMeow({
        handoffId,
        filename,
        mimeType,
        importMode,
        projectName,
      });
      handoffId = '';
      if (res.launched) {
        return {
          ok: true,
          channel: 'android-intent',
          message: `🐱 已发送到 Pixel Meow（${importMode === 'as_layer' ? '导入为图层' : '作为新项目打开'}）`,
        };
      }
    } catch (e) {
      console.warn('MeowBridge chunked sendToPixelMeow failed', e);
      if (handoffId) {
        await MeowBridge.cancelHandoff({ handoffId }).catch(() => {});
      }
    }
    const fallbackMsg = await saveFile(blob, filename, {
      folder: opts.exportPath,
      treeUri: opts.exportTreeUri,
      share: true,
    });
    return {
      ok: false,
      channel: 'fallback-share',
      message: `未检测到支持直连的新版 Pixel Meow，已${fallbackMsg}并拉起系统分享`,
    };
  }

  // Web / MCP cross-process / cross-tab handoff
  if (isMcpBridgeActive()) {
    try {
      const b64 = await blobToBase64(blob);
      const bridged = await mcpHandoffToPixelMeow({
        format: mimeType.includes('photoshop') ? 'psd' : 'png',
        dataBase64: b64,
        filename,
        projectName,
        importMode,
        autoOpenPixelMeow: true,
      });
      if (bridged.ok) {
        return {
          ok: true,
          channel: 'web-broadcast',
          message: bridged.message,
        };
      }
    } catch (e) {
      console.warn('MCP Pixel Meow handoff failed, trying BroadcastChannel/window fallback', e);
    }
  }

  const buf = await blob.arrayBuffer();
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // 1. Try 2-step BroadcastChannel election first (works when Pixel Meow is open on same origin)
  if (typeof BroadcastChannel !== 'undefined') {
    const sentViaBroadcast = await new Promise<boolean>((resolve) => {
      const ch = new BroadcastChannel('meow-bridge-v1');
      let done = false;
      let ackTimer: ReturnType<typeof setTimeout> | null = null;
      const claims: Array<{ tabId: string; visible: boolean; focused: boolean }> = [];

      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(offerTimer);
        if (ackTimer) clearTimeout(ackTimer);
        ch.close();
        resolve(ok);
      };

      const dispatchToWinner = () => {
        if (done) return;
        if (claims.length === 0) {
          finish(false);
          return;
        }
        claims.sort((a, b) => {
          const sa = (a.focused ? 2 : 0) + (a.visible ? 1 : 0);
          const sb = (b.focused ? 2 : 0) + (b.visible ? 1 : 0);
          return sb - sa;
        });
        const targetTabId = claims[0].tabId;
        ch.postMessage({
          type: 'BUILDER_MEOW_IMPORT',
          id,
          targetTabId,
          filename,
          mimeType,
          buffer: buf,
          importMode,
          projectName,
        });
        ackTimer = setTimeout(() => finish(false), 600);
      };

      ch.onmessage = (ev) => {
        const d = ev.data;
        if (!d || d.id !== id) return;
        if (d.type === 'BUILDER_MEOW_CLAIM' && typeof d.tabId === 'string') {
          claims.push({ tabId: d.tabId, visible: !!d.visible, focused: !!d.focused });
        } else if (d.type === 'BUILDER_MEOW_ACK') {
          finish(true);
        }
      };

      const offerTimer = setTimeout(dispatchToWinner, 150);
      ch.postMessage({ type: 'BUILDER_MEOW_OFFER', id });
    });

    if (sentViaBroadcast) {
      return {
        ok: true,
        channel: 'web-broadcast',
        message: '🐱 已直传到已打开的 Pixel Meow 标签页',
      };
    }
  }

  // 2. Open or reuse Pixel Meow Web URL in a named window and transfer via origin-pinned postMessage
  const rawBaseUrl = (opts.pixelMeowWebUrl || PIXEL_MEOW_ONLINE_URL).trim();
  let targetUrl = '';
  let targetOrigin = '';
  try {
    const parsed = new URL(rawBaseUrl, window.location.href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('不支持的协议');
    }
    if (!parsed.searchParams.has('handoff')) parsed.searchParams.set('handoff', '1');
    targetUrl = parsed.toString();
    targetOrigin = parsed.origin;
  } catch {
    const dlMsg = await saveFile(blob, filename, false);
    return {
      ok: false,
      channel: 'fallback-share',
      message: `Pixel Meow 网页地址无效（${rawBaseUrl}），已${dlMsg}`,
    };
  }

  const reuseCached = !!(
    cachedPixelMeowWin
    && !cachedPixelMeowWin.closed
    && cachedPixelMeowOrigin === targetOrigin
  );
  const win = reuseCached ? cachedPixelMeowWin : window.open(targetUrl, 'pixel_meow_target');
  if (win) {
    cachedPixelMeowWin = win;
    cachedPixelMeowOrigin = targetOrigin;
    try { win.focus(); } catch { /* ignore */ }

    const sent = await new Promise<boolean>((resolve) => {
      let finished = false;
      const cleanup = () => {
        window.removeEventListener('message', onMsg);
        clearTimeout(timeout);
        clearInterval(pingTimer);
      };
      const sendPayload = () => {
        if (finished) return;
        finished = true;
        cleanup();
        try {
          win.postMessage(
            {
              type: 'BUILDER_MEOW_IMPORT',
              id,
              filename,
              mimeType,
              buffer: buf,
              importMode,
              projectName,
            },
            targetOrigin,
            [buf],
          );
          resolve(true);
        } catch {
          resolve(false);
        }
      };
      const onMsg = (ev: MessageEvent) => {
        if (ev.origin !== targetOrigin || ev.source !== win) return;
        if (ev.data?.type === 'PIXEL_MEOW_READY' || (ev.data?.type === 'BUILDER_MEOW_ACK' && ev.data?.id === id)) {
          sendPayload();
        }
      };
      window.addEventListener('message', onMsg);
      const sendPing = () => {
        try {
          win.postMessage({ type: 'BUILDER_MEOW_PING' }, targetOrigin);
        } catch { /* ignore */ }
      };
      sendPing();
      const pingTimer = setInterval(sendPing, 250);
      const timeout = setTimeout(() => {
        if (!finished) {
          finished = true;
          cleanup();
          resolve(false);
        }
      }, 4500);
    });
    if (sent) {
      return {
        ok: true,
        channel: 'web-window',
        message: '🐱 已唤起 Pixel Meow 并完成分层工程导入',
      };
    }
    if (reuseCached) {
      cachedPixelMeowWin = null;
      cachedPixelMeowOrigin = '';
    }
  }

  const dlMsg = await saveFile(blob, filename, false);
  return {
    ok: false,
    channel: 'fallback-share',
    message: `未能自动连接到 Pixel Meow 网页（${rawBaseUrl}），已${dlMsg}，可在 Pixel Meow 中手动打开该文件`,
  };
}

// ------- IndexedDB key/value store -------
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open('buildermeow', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function kvSet(key: string, value: unknown) {
  const db = await idb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readonly');
    const r = tx.objectStore('kv').get(key);
    r.onsuccess = () => res(r.result as T);
    r.onerror = () => rej(r.error);
  });
}

export async function kvDel(key: string) {
  const db = await idb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function pickFile(accept: string, mode: 'document' | 'gallery' = 'document'): Promise<File | null> {
  if (isNative()) {
    try {
      const r = await DocumentPicker.pick({ mode });
      if (r.cancelled || !r.data) return null;
      return base64ToFile(r.data, r.name || 'file', r.mimeType || 'application/octet-stream');
    } catch (e) {
      console.warn('Native DocumentPicker fallback to web input', e);
    }
  }
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      inp.remove();
      res(file);
    };
    inp.onchange = () => finish(inp.files?.[0] ?? null);
    inp.addEventListener('cancel', () => finish(null));
    inp.click();
  });
}

export function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { res(img); URL.revokeObjectURL(url); };
    img.onerror = () => { rej(new Error('无法读取图像')); URL.revokeObjectURL(url); };
    img.src = url;
  });
}
