// Dialogs: Project Home, New Canvas & Plot, Save/Export (PSD/PNG/4-View/bmeow), Send to Pixel Meow, Settings & Theme
import type { App } from '../app';
import {
  canvasToPngBlob,
  deserializeBmeowProject,
  renderDocumentToPngCanvas,
  renderFourViewStripCanvas,
  serializeBmeowProject,
} from '../core/exporter';
import { exportBuilderPsd, exportFourViewLayersPsd, importPsdAsRasterLayers } from '../core/psd';
import { THEME_PRESETS, type ThemeId } from '../core/theme';
import { PIXEL_MEOW_ONLINE_URL } from '../core/about';
import { tr } from '../core/i18n';
import { cellsToMeters, metersToCells } from '../core/isoMath';
import { resolveAssetUrl } from '../core/theotownAssets';
import { isNative, pickFile, pickFolder, saveFile, sendToPixelMeowApp } from '../platform';
import { getMcpDefaultSaveDir, isMcpBridgeActive } from '../mcpBridge';
import { openShortcutsDialog, shortcutManager } from '../shortcuts/blenderShortcuts';
import { APP_VERSION, openChangelogDialog } from './changelogDialog';
import { confirm2, h, openSheet, rangeRow, select, toast, toggle } from './dom';

export function openNewProjectDialog(app: App, afterFit: () => void) {
  let canvasW = 256;
  let canvasH = 256;
  let plotU = 4;
  let plotV = 4;
  let withBase = true;
  let withShadow = true;

  const nameIn = h('input', { type: 'text', class: 'text-input', value: `等距建筑 ${app.projects.length + 1}` }) as HTMLInputElement;
  const wIn = h('input', { type: 'number', class: 'num wide', min: '64', max: '2048', value: '256' }) as HTMLInputElement;
  const hIn = h('input', { type: 'number', class: 'num wide', min: '64', max: '2048', value: '256' }) as HTMLInputElement;
  const uIn = h('input', { type: 'number', class: 'num', min: '1', max: '16', value: '4' }) as HTMLInputElement;
  const vIn = h('input', { type: 'number', class: 'num', min: '1', max: '16', value: '4' }) as HTMLInputElement;

  const body = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:8px' },
    h('div', { class: 'range-row' }, h('span', { class: 'rl' }, '项目名称'), nameIn),
    h('div', { class: 'menu-sec' }, '画布像素尺寸'),
    h(
      'div',
      { class: 'preset-row' },
      ...[
        [128, 128, '128×128'],
        [256, 256, '256×256'],
        [256, 384, '256×384 (高楼)'],
        [384, 384, '384×384'],
        [512, 512, '512×512'],
        [512, 1024, '512×1024 (摩天楼)'],
      ].map(([pw, ph, lbl]) =>
        h('button', {
          class: 'btn small',
          onclick: () => {
            canvasW = pw as number;
            canvasH = ph as number;
            wIn.value = String(canvasW);
            hIn.value = String(canvasH);
          },
        }, lbl as string),
      ),
    ),
    h('div', { class: 'range-row' }, h('span', { class: 'rl' }, '画布宽'), wIn, h('span', { class: 'rl' }, '画布高'), hIn),
    h('div', { class: 'menu-sec' }, 'TheoTown 场地格数（每格 32×16 px = 9.6×9.6 m）'),
    h(
      'div',
      { class: 'preset-row' },
      ...[1, 2, 3, 4, 6, 8].map((n) =>
        h('button', {
          class: 'btn small',
          onclick: () => {
            plotU = n;
            plotV = n;
            uIn.value = String(n);
            vIn.value = String(n);
          },
        }, `${n}×${n}`),
      ),
    ),
    h('div', { class: 'range-row' }, h('span', { class: 'rl' }, '场地 U 格'), uIn, h('span', { class: 'rl' }, '场地 V 格'), vIn),
    toggle('自动生成 TheoTown 绿地底座', withBase, (v) => { withBase = v; }),
    toggle('☀️ 自动生成 TheoTown 地面阴影 (#00071C5A)', withShadow, (v) => { withShadow = v; }),
  );

  let close = () => {};
  close = openSheet('新建等距建模项目', body, {
    actions: [
      h('button', { class: 'btn', onclick: () => close() }, '取消'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          canvasW = Math.max(32, Math.min(2048, Math.round(+wIn.value || 256)));
          canvasH = Math.max(32, Math.min(2048, Math.round(+hIn.value || 256)));
          plotU = Math.max(1, Math.min(24, Math.round(+uIn.value || 4)));
          plotV = Math.max(1, Math.min(24, Math.round(+vIn.value || 4)));
          app.newDocument(canvasW, canvasH, plotU, plotV, nameIn.value.trim() || '未命名工程', withBase, withShadow);
          close();
          afterFit();
        },
      }, '✓ 创建项目'),
    ],
  });
}

export async function openProjectHome(app: App, afterFit: () => void) {
  await app.autosave();
  let close = () => {};
  const listWrap = h('div', { class: 'proj-grid' });

  const renderCards = () => {
    listWrap.innerHTML = '';
    for (const p of app.projects) {
      const isCur = p.id === app.docId;
      const card = h(
        'div',
        { class: `proj-card${isCur ? ' active' : ''}` },
        p.thumb
          ? h('img', { src: p.thumb, class: 'proj-thumb' })
          : h('div', { class: 'proj-thumb empty' }, '3D'),
        h(
          'div',
          { class: 'proj-info' },
          h('div', { class: 'proj-name' }, p.name + (isCur ? ' (当前)' : '')),
          h('div', { class: 'hint' }, `${p.width}×${p.height} · ${p.plotU}×${p.plotV}格`),
        ),
        h(
          'div',
          { class: 'proj-actions' },
          h('button', {
            class: 'btn small primary',
            onclick: async () => {
              if (await app.openSavedProject(p.id)) {
                close();
                afterFit();
                toast(`已打开「${p.name}」`);
              }
            },
          }, '打开'),
          !isCur
            ? h('button', {
                class: 'btn small danger',
                onclick: async () => {
                  if (await confirm2('删除项目', `确定删除「${p.name}」？`)) {
                    await app.deleteSavedProject(p.id);
                    renderCards();
                  }
                },
              }, '删除')
            : null,
        ),
      );
      listWrap.append(card);
    }
  };
  renderCards();

  const body = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:10px' },
    h(
      'div',
      { class: 'brand-banner' },
      h('img', { src: resolveAssetUrl('./icon.png'), class: 'brand-logo' }),
      h(
        'div',
        {},
        h('div', { style: 'font-weight:700;font-size:15px' }, `Blender Meow v${APP_VERSION} · 等距像素建模工坊`),
        h('div', { class: 'hint' }, '32×16 菱形网格 · TheoTown 双比例尺 · 无缝导入 Pixel Meow'),
      ),
    ),
    h(
      'div',
      { class: 'preset-row' },
      h('button', {
        class: 'btn primary',
        onclick: () => {
          close();
          openNewProjectDialog(app, afterFit);
        },
      }, '✨ 新建项目'),
      h('button', {
        class: 'btn',
        onclick: async () => {
          const f = await pickFile('.bmeow,.psd,application/json', 'document');
          if (!f) return;
          try {
            if (/\.psd$/i.test(f.name)) {
              const layers = importPsdAsRasterLayers(await f.arrayBuffer(), app.doc);
              app.pushHistory(`导入 PSD ${f.name}`);
              for (const l of layers) app.doc.layers.unshift(l);
              app.doc.active = 0;
              app.emit('doc');
              app.emit('layers');
              close();
              toast(`已导入 ${layers.length} 个 PSD 参考图层`);
            } else {
              const txt = await f.text();
              const { doc, name } = await deserializeBmeowProject(txt);
              app.setDocument(doc, name);
              close();
              afterFit();
              toast(`已载入工程「${name}」`);
            }
          } catch (e) {
            toast('打开文件失败: ' + (e as Error).message);
          }
        },
      }, '📂 导入 .bmeow / .psd'),
      h('button', {
        class: 'btn',
        onclick: () => openChangelogDialog('manual'),
      }, `📜 版本更新日志 (v${APP_VERSION})`),
    ),
    h('div', { class: 'menu-sec' }, '本地已保存的项目'),
    listWrap,
  );

  close = openSheet('🏠 Blender Meow 项目主页', body, { wide: true });
}

export function openExportDialog(app: App) {
  let scale = 1;
  let trim = true;
  let includeRasters = true;
  let includeGroundShadow = app.doc.groundShadow.enabled;
  let includeInterBlockShadow = Boolean(app.doc.groundShadow.interBlockEnabled);

  const baseName = () => (app.docName || 'blender_meow').replace(/[\\/:*?"<>|]/g, '_');

  const body = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:10px' },
    h(
      'div',
      { class: 'range-row' },
      h('span', { class: 'rl' }, '导出倍率'),
      select<'1' | '2' | '4' | '8'>(
        [
          { id: '1', label: '1× (原像素尺寸，TheoTown 推荐)' },
          { id: '2', label: '2× (最近邻清晰放大)' },
          { id: '4', label: '4×' },
          { id: '8', label: '8×' },
        ],
        '1',
        (v) => { scale = Number(v); },
      ),
    ),
    toggle('✂️ 自动裁切四周透明留白', trim, (v) => { trim = v; }),
    toggle('🖼️ 包含导入的参考底图图层', includeRasters, (v) => { includeRasters = v; }),
    toggle('☀️ 包含自动地面阴影（PSD 中独立为「地面阴影」图层）', includeGroundShadow, (v) => { includeGroundShadow = v; }),
    toggle('🧪 包含体块间投射阴影（实验性 · PSD 中独立为「结构阴影」图层）', includeInterBlockShadow, (v) => {
      includeInterBlockShadow = v;
    }),
    h('div', { class: 'menu-sec' }, '导出格式'),
    h(
      'div',
      { class: 'export-btn-grid' },
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          try {
            const buf = exportBuilderPsd(app.doc, {
              scale,
              trim,
              includeRasters,
              includeGroundShadow,
              includeInterBlockShadow,
            });
            const msg = await saveFile(
              new Blob([buf], { type: 'image/vnd.adobe.photoshop' }),
              `${baseName()}.psd`,
              { folder: app.settings.exportPath, treeUri: app.settings.exportTreeUri, share: isNative() },
            );
            toast(`📑 ${msg}`);
          } catch (e) {
            toast('PSD 导出失败: ' + (e as Error).message);
          }
        },
      }, '📑 导出分层 PSD'),
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          try {
            const c = renderDocumentToPngCanvas(app.doc, {
              scale,
              trim,
              includeRasters,
              includeGroundShadow,
              includeInterBlockShadow,
            });
            const blob = await canvasToPngBlob(c);
            const msg = await saveFile(blob, `${baseName()}.png`, {
              folder: app.settings.exportPath,
              treeUri: app.settings.exportTreeUri,
              share: isNative(),
            });
            toast(`🖼️ ${msg} (${c.width}×${c.height})`);
          } catch (e) {
            toast('PNG 导出失败: ' + (e as Error).message);
          }
        },
      }, '🖼️ 导出当前视角 PNG'),
      h('button', {
        class: 'btn',
        onclick: async () => {
          try {
            const buf = exportFourViewLayersPsd(app.doc, {
              scale,
              trim,
              includeRasters,
              includeGroundShadow,
              includeInterBlockShadow,
            });
            const msg = await saveFile(
              new Blob([buf], { type: 'image/vnd.adobe.photoshop' }),
              `${baseName()}_4views.psd`,
              { folder: app.settings.exportPath, treeUri: app.settings.exportTreeUri, share: isNative() },
            );
            toast(`📑 ${msg}`);
          } catch (e) {
            toast('所有视角图层 PSD 导出失败: ' + (e as Error).message);
          }
        },
      }, '📑 导出所有视角（图层 PSD）'),
      h('button', {
        class: 'btn',
        onclick: async () => {
          try {
            const strip = renderFourViewStripCanvas(app.doc, {
              scale,
              trim,
              includeRasters,
              includeGroundShadow,
              includeInterBlockShadow,
            });
            const blob = await canvasToPngBlob(strip);
            const msg = await saveFile(blob, `${baseName()}_4views.png`, {
              folder: app.settings.exportPath,
              treeUri: app.settings.exportTreeUri,
              share: isNative(),
            });
            toast(`🔄 ${msg} (${strip.width}×${strip.height})`);
          } catch (e) {
            toast('四向拼接导出失败: ' + (e as Error).message);
          }
        },
      }, '🔄 导出四向旋转拼接 PNG (0°/90°/180°/270°)'),
      h('button', {
        class: 'btn',
        onclick: async () => {
          try {
            const json = serializeBmeowProject(app.doc, app.docName);
            const msg = await saveFile(
              new Blob([json], { type: 'application/json' }),
              `${baseName()}.bmeow`,
              { folder: app.settings.exportPath, treeUri: app.settings.exportTreeUri, share: false },
            );
            toast(`💾 ${msg}`);
          } catch (err) {
            console.error('export bmeow failed', err);
            toast(`保存工程失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      }, '💾 保存可编辑工程 (.bmeow)'),
    ),
  );

  openSheet('💾 保存与导出项目', body);
}

export function openSendToPixelMeowDialog(app: App) {
  let format: 'psd' | 'png' = 'psd';
  let exportScope: 'all_layers' | 'active_layer' | 'four_views' = 'all_layers';
  let importMode: 'new_project' | 'as_layer' = 'new_project';
  let trim = true;
  let includeRasters = true;
  let hideBase = false;
  let includeGroundShadow = app.doc.groundShadow.enabled;
  let includeInterBlockShadow = Boolean(app.doc.groundShadow.interBlockEnabled);
  let scale = 1;

  const urlIn = h('input', {
    type: 'text',
    class: 'text-input',
    value: app.settings.pixelMeowWebUrl,
    placeholder: PIXEL_MEOW_ONLINE_URL,
    onchange: () => {
      app.settings.pixelMeowWebUrl = urlIn.value.trim() || PIXEL_MEOW_ONLINE_URL;
      app.saveSettings();
    },
  }) as HTMLInputElement;

  const useOnlineBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn small',
      onclick: () => {
        urlIn.value = PIXEL_MEOW_ONLINE_URL;
        app.settings.pixelMeowWebUrl = PIXEL_MEOW_ONLINE_URL;
        app.saveSettings();
        toast('已切换为 Pixel Meow 在线版地址');
      },
    },
    '🌐 使用在线版',
  );

  const body = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:10px' },
    h('p', { class: 'hint' }, '将当前等距视角下的建模结果一键传送到 Pixel Meow 画布进行像素细化、描边与 TheoTown 对齐。'),
    h(
      'div',
      { class: 'range-row' },
      h('span', { class: 'rl' }, '传输格式'),
      select<'psd' | 'png'>(
        [
          { id: 'psd', label: '分层 PSD（保留全部独立立体图层，推荐）' },
          { id: 'png', label: '合并 PNG（单层硬边缘像素图）' },
        ],
        format,
        (v) => { format = v; },
      ),
    ),
    h(
      'div',
      { class: 'range-row' },
      h('span', { class: 'rl' }, '导出范围'),
      select<'all_layers' | 'active_layer' | 'four_views'>(
        [
          { id: 'all_layers', label: '全部图层（保留立体分层 / 含四向基础结构）' },
          { id: 'active_layer', label: '仅当前选中图层（单独精修指定构建块）' },
          { id: 'four_views', label: '所有视角（0° / 90° / 180° / 270° 四图层 PSD）' },
        ],
        exportScope,
        (v) => {
          exportScope = v;
          if (v === 'four_views') format = 'psd';
        },
      ),
    ),
    h(
      'div',
      { class: 'range-row' },
      h('span', { class: 'rl' }, '导入方式'),
      select<'new_project' | 'as_layer'>(
        [
          { id: 'new_project', label: '在 Pixel Meow 中作为新项目打开' },
          { id: 'as_layer', label: '导入到 Pixel Meow 当前画布图层' },
        ],
        importMode,
        (v) => { importMode = v; },
      ),
    ),
    h(
      'div',
      { class: 'range-row' },
      h('span', { class: 'rl' }, '输出倍率'),
      select<'1' | '2' | '4'>(
        [
          { id: '1', label: '1× (原像素)' },
          { id: '2', label: '2×' },
          { id: '4', label: '4×' },
        ],
        '1',
        (v) => { scale = Number(v); },
      ),
    ),
    toggle('✂️ 自动裁切四周透明留白', trim, (v) => { trim = v; }),
    toggle('🖼️ 包含参考底图图层', includeRasters, (v) => { includeRasters = v; }),
    toggle('🙈 隐藏 TheoTown 绿地底座 (theotown_base)', hideBase, (v) => { hideBase = v; }),
    toggle('☀️ 包含自动地面阴影图层', includeGroundShadow, (v) => { includeGroundShadow = v; }),
    toggle('🧪 包含体块间投射阴影（实验性 · 独立「结构阴影」图层）', includeInterBlockShadow, (v) => {
      includeInterBlockShadow = v;
    }),
    !isNative() && !isMcpBridgeActive()
      ? h('div', { class: 'range-row' }, h('span', { class: 'rl' }, 'Pixel Meow 地址'), urlIn, useOnlineBtn)
      : null,
  );

  let close = () => {};
  let sending = false;
  close = openSheet('🐱 一键导入到 Pixel Meow', body, {
    actions: [
      h('button', { class: 'btn', onclick: () => close() }, '取消'),
      h('button', {
        class: 'btn primary',
        onclick: async (ev: MouseEvent) => {
          if (sending) return;
          sending = true;
          const btn = ev.currentTarget as HTMLButtonElement | null;
          if (btn) btn.disabled = true;
          const origLayers = [...app.doc.layers];
          const origActive = app.doc.active;
          const origVis = origLayers.map((l) => l.visible);
          let blob: Blob | null = null;
          let pngCanvas: HTMLCanvasElement | null = null;
          let filename = '';
          try {
            try {
              if (exportScope === 'active_layer' && app.doc.layer) {
                app.doc.layers = [app.doc.layer];
                app.doc.active = 0;
              }
              if (hideBase) {
                for (const l of origLayers) {
                  if (l.shape?.shapeType === 'theotown_base') l.visible = false;
                }
              }
              const clean = (app.docName || 'blender_meow').replace(/[\\/:*?"<>|]/g, '_');
              if (exportScope === 'four_views') {
                const buf = exportFourViewLayersPsd(app.doc, {
                  scale,
                  trim,
                  includeRasters,
                  includeGroundShadow,
                  includeInterBlockShadow,
                });
                blob = new Blob([buf], { type: 'image/vnd.adobe.photoshop' });
                filename = `${clean}_4views.psd`;
              } else if (format === 'psd') {
                const buf = exportBuilderPsd(app.doc, {
                  scale,
                  trim,
                  includeRasters,
                  includeGroundShadow,
                  includeInterBlockShadow,
                });
                blob = new Blob([buf], { type: 'image/vnd.adobe.photoshop' });
                filename = `${clean}.psd`;
              } else {
                pngCanvas = renderDocumentToPngCanvas(app.doc, {
                  scale,
                  trim,
                  includeRasters,
                  includeGroundShadow,
                  includeInterBlockShadow,
                });
                filename = `${clean}.png`;
              }
            } finally {
              // Restore mutated layer array/visibility synchronously before any await
              app.doc.layers = origLayers;
              app.doc.active = origActive;
              origLayers.forEach((l, i) => { l.visible = origVis[i]; });
            }
            if (pngCanvas) {
              blob = await canvasToPngBlob(pngCanvas);
            }
            const res = await sendToPixelMeowApp(blob!, filename, importMode, app.docName, {
              pixelMeowWebUrl: app.settings.pixelMeowWebUrl,
              exportPath: app.settings.exportPath,
              exportTreeUri: app.settings.exportTreeUri,
            });
            close();
            toast(res.message);
          } catch (err) {
            console.error('sendToPixelMeow failed', err);
            toast(`导入到 Pixel Meow 失败: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            sending = false;
            if (btn) btn.disabled = false;
          }
        },
      }, '🚀 立即导入 Pixel Meow'),
    ],
  });
}

export function openSettingsDialog(app: App) {
  const folderIn = h('input', {
    type: 'text',
    class: 'text-input',
    value: app.settings.exportPath,
    onchange: () => {
      app.settings.exportPath = folderIn.value.trim() || 'BlenderMeow';
      app.saveSettings();
    },
  }) as HTMLInputElement;

  const urlIn = h('input', {
    type: 'text',
    class: 'text-input',
    value: app.settings.pixelMeowWebUrl,
    placeholder: PIXEL_MEOW_ONLINE_URL,
    onchange: () => {
      app.settings.pixelMeowWebUrl = urlIn.value.trim() || PIXEL_MEOW_ONLINE_URL;
      app.saveSettings();
    },
  }) as HTMLInputElement;

  const useOnlineBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn small',
      onclick: () => {
        urlIn.value = PIXEL_MEOW_ONLINE_URL;
        app.settings.pixelMeowWebUrl = PIXEL_MEOW_ONLINE_URL;
        app.saveSettings();
        toast('已切换为 Pixel Meow 在线版地址');
      },
    },
    '🌐 使用在线版',
  );

  let cleanupDocSync: (() => void) | null = null;
  const body = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:10px' },
    h('div', { class: 'menu-sec' }, '界面主题'),
    h(
      'div',
      { class: 'range-row' },
      h('span', { class: 'rl' }, '配色主题'),
      select<ThemeId>(
        THEME_PRESETS.map((t) => ({ id: t.id, label: `${t.badge} ${t.name}` })),
        app.settings.uiTheme,
        (t) => {
          app.settings.uiTheme = t;
          app.saveSettings();
        },
      ),
    ),
    h('div', { class: 'menu-sec' }, '体块与曲面光影（随当前工程保存，并作为新建工程默认值）'),
    ...(() => {
      type ShadePresetId = '0' | '32' | '16' | '10' | '6' | '4' | 'custom';
      const stepsToPresetId = (steps: number): ShadePresetId => {
        if (steps <= 0) return '0';
        if (steps === 32 || steps === 16 || steps === 10 || steps === 6 || steps === 4) {
          return String(steps) as ShadePresetId;
        }
        return 'custom';
      };
      const formatShadeModeHint = (steps: number): string =>
        steps <= 0
          ? '当前：无极连续平滑渐变（最高精细度）；拖动下方滑条可立即切换为 3 ~ 64 档分段像素色阶'
          : `当前：分段像素色阶（${steps} 档），拖动下方滑条可在 3 ~ 64 档之间微调`;

      const shadeHint = h('div', { class: 'hint' }, formatShadeModeHint(app.doc.shadeSteps));
      let shadePresetSel!: HTMLSelectElement;
      let pendingLiveSteps: number | null = null;
      let liveRaf = 0;
      const flushLiveSteps = () => {
        liveRaf = 0;
        if (pendingLiveSteps !== null) {
          const val = pendingLiveSteps;
          pendingLiveSteps = null;
          app.setShadeSteps(val, { live: true, persistDefault: true });
        }
      };
      const shadeSlider = rangeRow(
        '色阶细分档数',
        3,
        64,
        app.doc.shadeSteps > 0 ? app.doc.shadeSteps : 64,
        (v) => {
          pendingLiveSteps = v;
          shadePresetSel.value = stepsToPresetId(v);
          shadeHint.textContent = tr(formatShadeModeHint(v));
          shadeSlider.row.style.opacity = '1';
          if (!liveRaf) {
            liveRaf = requestAnimationFrame(flushLiveSteps);
          }
        },
        1,
        {
          onBegin: () => {
            app.pushHistory('调整光影精细度');
          },
          onCommit: (v) => {
            if (liveRaf) {
              cancelAnimationFrame(liveRaf);
              liveRaf = 0;
            }
            pendingLiveSteps = null;
            app.setShadeSteps(v, { live: false, persistDefault: true });
            shadePresetSel.value = stepsToPresetId(v);
            shadeHint.textContent = tr(formatShadeModeHint(v));
            shadeSlider.row.style.opacity = '1';
          },
        },
      );
      shadeSlider.row.style.opacity = app.doc.shadeSteps <= 0 ? '0.62' : '1';
      shadePresetSel = select<ShadePresetId>(
        [
          { id: '0', label: '✨ 无极连续平滑（最高精细度 · 默认）' },
          { id: '32', label: '🎨 超高精细色阶（32 档）' },
          { id: '16', label: '🌤️ 高精细色阶（16 档）' },
          { id: '10', label: '🧱 标准像素色阶（10 档）' },
          { id: '6', label: '👾 经典像素色块（6 档 · 旧版风格）' },
          { id: '4', label: '🔲 极简硬朗色块（4 档 · 易填色）' },
          { id: 'custom', label: '🎛️ 自定义色阶档数' },
        ],
        stepsToPresetId(app.doc.shadeSteps),
        (v) => {
          if (v === '0') {
            app.setShadeSteps(0, { pushHistory: '调整光影精细度', persistDefault: true });
            shadeSlider.set(64);
            shadeSlider.row.style.opacity = '0.62';
            shadeHint.textContent = tr(formatShadeModeHint(0));
          } else if (v === 'custom') {
            const next = app.doc.shadeSteps > 0 ? app.doc.shadeSteps : 12;
            app.setShadeSteps(next, { pushHistory: '调整光影精细度', persistDefault: true });
            shadeSlider.set(next);
            shadeSlider.row.style.opacity = '1';
            shadeHint.textContent = tr(formatShadeModeHint(next));
          } else {
            const next = Number(v);
            app.setShadeSteps(next, { pushHistory: '调整光影精细度', persistDefault: true });
            shadeSlider.set(next);
            shadeSlider.row.style.opacity = '1';
            shadeHint.textContent = tr(formatShadeModeHint(next));
          }
        },
      );
      const presetRow = h('div', { class: 'range-row' }, h('span', { class: 'rl' }, '光影精细度'), shadePresetSel);
      const interBlockRow = toggle(
        '🧪 启用体块间投射阴影（实验性 · 当前工程生效，与地面阴影共用颜色）',
        Boolean(app.doc.groundShadow.interBlockEnabled),
        (v) => {
          app.setGroundShadow(
            { interBlockEnabled: v },
            { pushHistory: v ? '启用体块间投射阴影 (实验)' : '关闭体块间投射阴影' },
          );
        },
      );
      const interBlockCb = interBlockRow.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      const unsub = app.on((what) => {
        if (what !== 'doc' && what !== 'history') return;
        const curSteps = app.doc.shadeSteps;
        shadePresetSel.value = stepsToPresetId(curSteps);
        shadeSlider.set(curSteps > 0 ? curSteps : 64);
        shadeSlider.row.style.opacity = curSteps <= 0 ? '0.62' : '1';
        shadeHint.textContent = tr(formatShadeModeHint(curSteps));
        if (interBlockCb) interBlockCb.checked = Boolean(app.doc.groundShadow.interBlockEnabled);
      });
      cleanupDocSync = () => {
        if (liveRaf) {
          cancelAnimationFrame(liveRaf);
          liveRaf = 0;
        }
        unsub();
      };
      return [presetRow, shadeSlider.row, shadeHint, interBlockRow];
    })(),
    h('div', { class: 'menu-sec' }, '画布与建模交互'),
    toggle('显示 32×16 等距菱形网格', app.settings.showIsoGrid, (v) => {
      app.settings.showIsoGrid = v;
      app.saveSettings();
    }),
    toggle('旋转 90° 时自动按遮挡深度排层', app.doc.autoSortOnRotate, (v) => {
      app.doc.autoSortOnRotate = v;
      app.emit('doc');
    }),
    toggle('新建/移动图形时自动按深度排层', app.settings.autoSortOnEdit, (v) => {
      app.settings.autoSortOnEdit = v;
      app.saveSettings();
      app.emit('view');
    }),
    toggle('拖拽移动时自动叠放到下方物体顶面', app.settings.autoStackSnap, (v) => {
      app.settings.autoStackSnap = v;
      app.saveSettings();
    }),
    toggle('启用双指撤回 / 三指重做手势', app.settings.gestureUndoRedo, (v) => {
      app.settings.gestureUndoRedo = v;
      app.saveSettings();
    }),
    h('div', { class: 'menu-sec' }, '纹理素材库显示模式'),
    toggle('侧边停靠纹理库菜单（开启后可在材质/图层菜单打开时并排使用；关闭则全屏弹出）', app.settings.dockedTextureLibrary, (v) => {
      app.settings.dockedTextureLibrary = v;
      app.saveSettings();
      app.emit('settings');
    }),
    h('div', { class: 'menu-sec' }, '键盘快捷键与预设方案'),
    (() => {
      const presetHint = h('span', { class: 'hint' }, `当前：${shortcutManager.getActivePresetName()}`);
      const btn = h(
        'button',
        {
          class: 'btn small',
          onclick: () => openShortcutsDialog(),
        },
        '⌨️ 自定义键盘快捷键与预设方案...',
      );
      return h(
        'div',
        { style: 'display:flex;flex-direction:column;gap:5px' },
        btn,
        presetHint,
      );
    })(),
    h('div', { class: 'menu-sec' }, '保存路径与联动'),
    h('div', { class: 'range-row' }, h('span', { class: 'rl' }, '默认保存目录'), folderIn),
    isNative()
      ? h('button', {
          class: 'btn small',
          onclick: async () => {
            const picked = await pickFolder();
            if (picked) {
              app.settings.exportTreeUri = picked.uri;
              app.settings.exportPath = picked.name;
              folderIn.value = picked.name;
              app.saveSettings();
              toast(`已绑定保存目录: ${picked.name}`);
            }
          },
        }, '📁 选择 Android 自定义保存文件夹 (SAF)')
      : isMcpBridgeActive()
        ? h(
            'div',
            { style: 'display:flex;flex-direction:column;gap:6px' },
            h(
              'button',
              {
                class: 'btn small',
                onclick: async () => {
                  const picked = await pickFolder();
                  if (picked) {
                    app.settings.exportPath = picked.name;
                    folderIn.value = picked.name;
                    app.saveSettings();
                    toast(`已设置保存目录: ${picked.name}`);
                  }
                },
              },
              `📁 选择电脑保存目录（默认工作区: ${getMcpDefaultSaveDir()}）`,
            ),
            h('div', { class: 'range-row' }, h('span', { class: 'rl' }, 'Pixel Meow 网页'), urlIn, useOnlineBtn),
          )
        : h('div', { class: 'range-row' }, h('span', { class: 'rl' }, 'Pixel Meow 网页'), urlIn, useOnlineBtn),
  );

  openSheet('⚙️ Blender Meow 设置', body, {
    onClose: () => {
      cleanupDocSync?.();
    },
  });
}

function makePlotDualInput(
  label: string,
  initialCells: number,
  minCells: number,
  onCommit: (cells: number) => void,
) {
  const cIn = h('input', {
    type: 'number',
    class: 'num dual',
    step: '0.25',
    min: String(minCells),
    value: String(Math.round(initialCells * 1000) / 1000),
  }) as HTMLInputElement;
  const mIn = h('input', {
    type: 'number',
    class: 'num dual',
    step: '0.1',
    min: String(Math.round(cellsToMeters(minCells) * 100) / 100),
    value: String(Math.round(cellsToMeters(initialCells) * 100) / 100),
  }) as HTMLInputElement;

  const sync = (v: number) => {
    const rv = Math.max(minCells, Math.round(v * 1000) / 1000);
    cIn.value = String(rv);
    mIn.value = String(Math.round(cellsToMeters(rv) * 100) / 100);
    return rv;
  };

  cIn.onchange = () => onCommit(sync(+cIn.value || 0));
  mIn.onchange = () => {
    const m = Math.max(cellsToMeters(minCells), +mIn.value || 0);
    const cells = Math.round(metersToCells(m) * 16) / 16;
    onCommit(sync(cells));
  };

  return {
    el: h(
      'div',
      { class: 'dual-row' },
      h('span', { class: 'rl' }, label),
      cIn,
      h('span', { class: 'unit-tag' }, '格'),
      mIn,
      h('span', { class: 'unit-tag' }, 'm'),
    ),
    setCells(v: number) {
      cIn.value = String(Math.round(v * 1000) / 1000);
      mIn.value = String(Math.round(cellsToMeters(v) * 100) / 100);
    },
  };
}

export function openPlotFrameDialog(app: App) {
  const pf = app.doc.plotFrame;

  const uRow = makePlotDualInput('U 起点', pf.u, -16, (v) => {
    if (Math.abs(app.doc.plotFrame.u - v) < 1e-6) return;
    app.pushHistory('调整场地边框位置');
    app.doc.plotFrame.u = v;
    app.emit('doc');
  });
  const vRow = makePlotDualInput('V 起点', pf.v, -16, (v) => {
    if (Math.abs(app.doc.plotFrame.v - v) < 1e-6) return;
    app.pushHistory('调整场地边框位置');
    app.doc.plotFrame.v = v;
    app.emit('doc');
  });
  const suRow = makePlotDualInput('U 宽度', pf.sizeU, 0.25, (v) => {
    const next = Math.max(0.25, v);
    if (Math.abs(app.doc.plotFrame.sizeU - next) < 1e-6) return;
    app.pushHistory('调整场地边框尺寸');
    app.doc.plotFrame.sizeU = next;
    app.emit('doc');
  });
  const svRow = makePlotDualInput('V 深度', pf.sizeV, 0.25, (v) => {
    const next = Math.max(0.25, v);
    if (Math.abs(app.doc.plotFrame.sizeV - next) < 1e-6) return;
    app.pushHistory('调整场地边框尺寸');
    app.doc.plotFrame.sizeV = next;
    app.emit('doc');
  });

  const body = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:10px' },
    h('p', { class: 'hint' }, '控制地面青色等距场地边框及 N / E / S / W 方向标识的显隐、位置与尺寸，也可直接在画布拖拽边线调整。'),
    toggle('显示地面方向场地边框 (N / E / S / W)', pf.visible, (v) => {
      if (app.doc.plotFrame.visible === v) return;
      app.pushHistory(v ? '显示场地边框' : '隐藏场地边框');
      app.doc.plotFrame.visible = v;
      app.emit('doc');
    }),
    h('div', { class: 'menu-sec' }, '位置与尺寸（格 ⇄ TheoTown 米）'),
    uRow.el,
    vRow.el,
    suRow.el,
    svRow.el,
    h('div', { class: 'menu-sec' }, '快捷尺寸预设'),
    h(
      'div',
      { class: 'preset-row' },
      ...[1, 2, 3, 4, 6, 8].map((n) =>
        h('button', {
          class: 'btn small',
          onclick: () => {
            const cur = app.doc.plotFrame;
            if (cur.visible && Math.abs(cur.sizeU - n) < 1e-6 && Math.abs(cur.sizeV - n) < 1e-6) return;
            app.pushHistory(`场地边框设为 ${n}×${n}`);
            app.doc.plotFrame.visible = true;
            app.doc.plotFrame.sizeU = n;
            app.doc.plotFrame.sizeV = n;
            suRow.setCells(n);
            svRow.setCells(n);
            app.emit('doc');
            toast(`场地边框已设为 ${n}×${n} 格`);
          },
        }, `${n}×${n}`),
      ),
    ),
    h(
      'div',
      { class: 'preset-row' },
      h('button', {
        class: 'btn small',
        onclick: () => {
          const nu = Math.round(((app.doc.plotU - app.doc.plotFrame.sizeU) * 0.5) * 16) / 16;
          const nv = Math.round(((app.doc.plotV - app.doc.plotFrame.sizeV) * 0.5) * 16) / 16;
          if (Math.abs(app.doc.plotFrame.u - nu) < 1e-6 && Math.abs(app.doc.plotFrame.v - nv) < 1e-6) return;
          app.pushHistory('居中对齐场地边框');
          app.doc.plotFrame.u = nu;
          app.doc.plotFrame.v = nv;
          uRow.setCells(nu);
          vRow.setCells(nv);
          app.emit('doc');
          toast('已居中对齐当前场地');
        },
      }, '📐 居中对齐当前场地'),
      h('button', {
        class: 'btn small',
        onclick: () => {
          const cur = app.doc.plotFrame;
          if (
            cur.visible
            && Math.abs(cur.u) < 1e-6
            && Math.abs(cur.v) < 1e-6
            && Math.abs(cur.sizeU - app.doc.plotU) < 1e-6
            && Math.abs(cur.sizeV - app.doc.plotV) < 1e-6
          ) {
            return;
          }
          app.pushHistory('复位场地边框');
          app.doc.plotFrame = {
            visible: true,
            u: 0,
            v: 0,
            sizeU: app.doc.plotU,
            sizeV: app.doc.plotV,
          };
          uRow.setCells(0);
          vRow.setCells(0);
          suRow.setCells(app.doc.plotU);
          svRow.setCells(app.doc.plotV);
          app.emit('doc');
          toast(`已复位为默认 ${app.doc.plotU}×${app.doc.plotV} 格`);
        },
      }, `↺ 复位默认 (0, 0, ${app.doc.plotU}×${app.doc.plotV})`),
    ),
  );

  let close = () => {};
  close = openSheet('🧭 地面方向场地边框设置', body, {
    actions: [h('button', { class: 'btn primary', onclick: () => close() }, '完成')],
  });
}
