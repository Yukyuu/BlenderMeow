#!/usr/bin/env node
// Universal PC stdio MCP Server for Blender Meow Live 3D Studio + Pixel Meow Handoff
// Zero external npm dependencies; works with Antigravity, Claude Code, Cursor, Codex, Gemini CLI, Windsurf, etc.

import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_HUB_PORT,
  FALLBACK_SAVE_DIR,
  HUB_VERSION,
  SNAPSHOT_DIR,
  detectInitialWorkspaceRoot,
  ensureDirs,
  ensureHubRunning,
  forwardToHub,
  handoffToPixelMeowHub,
} from './hub.mjs';

let hubHandle = null;
let framingMode = 'jsonl'; // 'jsonl' | 'lsp'

function writeMessage(msg) {
  const json = JSON.stringify(msg);
  if (framingMode === 'lsp') {
    const byteLen = Buffer.byteLength(json, 'utf8');
    process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
  } else {
    process.stdout.write(json + '\n');
  }
}

function sendResult(id, result) {
  if (id === undefined || id === null) return;
  writeMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message, data) {
  if (id === undefined || id === null) return;
  writeMessage({
    jsonrpc: '2.0',
    id,
    error: data !== undefined ? { code, message, data } : { code, message },
  });
}

function toForwardSlashes(p) {
  return String(p || '').replace(/\\/g, '/');
}

function defaultAutoOpen() {
  if (process.env.BLENDERMEOW_AUTO_OPEN === '0' || process.env.BLENDERMEOW_AUTO_OPEN === 'false') {
    return false;
  }
  if (process.env.BLENDERMEOW_AUTO_OPEN === '1' || process.env.BLENDERMEOW_AUTO_OPEN === 'true') {
    return true;
  }
  return true;
}

async function getActiveHub() {
  if (!hubHandle) {
    hubHandle = await ensureHubRunning({
      port: DEFAULT_HUB_PORT,
      autoOpenAllowed: defaultAutoOpen(),
    });
  }
  return hubHandle;
}

async function callHubExec(command, opts = {}) {
  let hub = await getActiveHub();
  if (hub.ownsServer && typeof hub.execCommandOnCanvas === 'function') {
    const data = await hub.execCommandOnCanvas(command, {
      autoOpen: opts.autoOpen ?? defaultAutoOpen(),
      timeoutMs: opts.timeoutMs ?? 30000,
    });
    return data.result ?? data;
  }

  let res = await forwardToHub(hub.port, '/exec', 'POST', {
    command,
    autoOpen: opts.autoOpen ?? defaultAutoOpen(),
    timeoutMs: opts.timeoutMs ?? 30000,
  });

  if (res.status >= 500 && String(res.data?.error || '').includes('ECONNREFUSED')) {
    hubHandle = null;
    hub = await getActiveHub();
    res = await forwardToHub(hub.port, '/exec', 'POST', {
      command,
      autoOpen: opts.autoOpen ?? defaultAutoOpen(),
      timeoutMs: opts.timeoutMs ?? 30000,
    });
  }

  if (res.status >= 400 || !res.data?.ok) {
    throw new Error(res.data?.error || `Studio command failed with HTTP ${res.status}`);
  }
  return res.data.result ?? res.data;
}

async function getHubWorkspaceDir() {
  try {
    const hub = await getActiveHub();
    const health = await forwardToHub(hub.port, '/health', 'GET');
    if (health.status === 200 && health.data) {
      if (health.data.workspaceRoot && fs.existsSync(health.data.workspaceRoot)) {
        return health.data.workspaceRoot;
      }
      const localWs = detectInitialWorkspaceRoot();
      if (localWs) return localWs;
      if (health.data.defaultSaveDir) return health.data.defaultSaveDir;
    }
  } catch {
    // fallback below
  }
  return detectInitialWorkspaceRoot() || FALLBACK_SAVE_DIR;
}

async function resolveMcpFilePath(rawFilePath, fallbackFileName = '') {
  const baseDir = await getHubWorkspaceDir();
  const trimmed = String(rawFilePath || '').trim();
  if (!trimmed) {
    if (!fallbackFileName) {
      throw new Error('filePath is required');
    }
    return path.resolve(baseDir, fallbackFileName);
  }
  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed);
  }
  return path.resolve(baseDir, trimmed);
}

const TOOLS = [
  {
    name: 'studio_open',
    description:
      '[#M1] Ensure the Blender Meow live 3D studio hub is running and optionally launch the desktop web window (or return the Antigravity Sidecar link & localhost URL). Call this at the start of a 3D isometric modeling session.',
    inputSchema: {
      type: 'object',
      properties: {
        autoOpen: {
          type: 'boolean',
          description:
            'If no live studio client is connected yet, open a standalone browser app window automatically (default follows BLENDERMEOW_AUTO_OPEN; pass false when working inside the Antigravity Sidecar pane).',
        },
      },
    },
  },
  {
    name: 'studio_get_state',
    description:
      '[#M2] Inspect current Blender Meow 3D project dimensions, TheoTown plot grid (plotU/plotV in cells & meters), viewRotation (0..3 -> 0..270deg), all parametric 3D and raster layers (geometry metrics, colors, arch/loft/column sections, planar face specs & textures), texture groups/library assets, and undo/redo availability.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'studio_doc_action',
    description:
      '[#M3] Document actions: new_doc, resize_canvas, set_plot, set_ground_shadow, set_shade_steps, rotate_view, sort_depth, undo/redo, export_psd/export_png/export_bmeow, import_psd/import_bmeow.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'new_doc',
            'resize_canvas',
            'set_plot',
            'set_ground_shadow',
            'set_shade_steps',
            'rotate_view',
            'sort_depth',
            'undo',
            'redo',
            'export_psd',
            'export_png',
            'export_bmeow',
            'import_psd',
            'import_bmeow',
          ],
        },
        name: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        plotU: { type: 'number' },
        plotV: { type: 'number' },
        withBase: { type: 'boolean' },
        withGroundShadow: { type: 'boolean' },
        enabled: { type: 'boolean' },
        interBlockEnabled: { type: 'boolean' },
        color: { type: 'string', description: 'Hex/rgba (#00071C5A default).' },
        opacity: { type: 'number', description: '0..1 alpha.' },
        opacityPct: { type: 'number', description: '0..100%.' },
        shadeSteps: { type: 'number', description: '0 smooth; 3..64 cel bands (per-doc).' },
        dx: { type: 'number' },
        dy: { type: 'number' },
        bottomMarginPx: { type: 'number' },
        plotFrame: {
          type: 'object',
          properties: {
            visible: { type: 'boolean' },
            u: { type: 'number' },
            v: { type: 'number' },
            sizeU: { type: 'number' },
            sizeV: { type: 'number' },
          },
        },
        steps: { type: 'number' },
        viewRotation: { type: 'number' },
        angleDeg: { type: 'number' },
        filePath: { type: 'string' },
        scale: { type: 'number' },
        trim: { type: 'boolean' },
        includeRasters: { type: 'boolean' },
        includeGroundShadow: { type: 'boolean' },
        includeInterBlockShadow: { type: 'boolean' },
        fourViews: { type: 'boolean' },
        hideTheoTownBase: { type: 'boolean' },
        excludeTheoTownBase: { type: 'boolean' },
        activeOnly: { type: 'boolean' },
        layerIds: { type: 'array', items: { type: 'number' } },
        layerNames: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'studio_layer_action',
    description:
      '[#M4] Manage 3D and raster layers: select, update (name/visible/opacity/blend/locked/rasterRole), duplicate, delete, clear_all, move (delta/toIndex), stack_on_below (snap Z elevation neatly onto underlying roof/floor), or add_raster (import reference PNG as underlay/overlay).',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['select', 'update', 'duplicate', 'delete', 'clear_all', 'move', 'stack_on_below', 'add_raster'],
        },
        layerId: { type: 'number' },
        layerName: { type: 'string' },
        layerIndex: { type: 'number' },
        name: { type: 'string' },
        visible: { type: 'boolean' },
        opacity: { type: 'number' },
        locked: { type: 'boolean' },
        blend: {
          type: 'string',
          enum: [
            'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
            'color-dodge', 'color-burn', 'hard-light', 'soft-light',
            'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
          ],
        },
        rasterRole: { type: 'string', enum: ['underlay', 'overlay'] },
        delta: { type: 'number' },
        toIndex: { type: 'number' },
        withBase: { type: 'boolean', description: 'Recreate TheoTown base during clear_all.' },
        filePath: { type: 'string', description: 'Local PNG path for add_raster.' },
      },
    },
  },
  {
    name: 'studio_upsert_shape',
    description:
      '[#M5] Create or update a 3D parametric shape layer (mode: auto|create|update). Shapes: box, right_tri_prism, arch, cylinder, loft, prism, wedge, pyramid, cone, dome, theotown_base. Supports cells/zPx or meters (1 cell=9.6m, 3px=1.6m), stackOnBelow, archPreset/loftPreset, shading/outline, and pattern.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['auto', 'create', 'update'] },
        layerId: { type: 'number' },
        layerIndex: { type: 'number' },
        name: { type: 'string' },
        shapeType: {
          type: 'string',
          enum: ['box', 'right_tri_prism', 'arch', 'cylinder', 'loft', 'prism', 'wedge', 'pyramid', 'cone', 'dome', 'theotown_base'],
        },
        u: { type: 'number' },
        v: { type: 'number' },
        sizeU: { type: 'number' },
        sizeV: { type: 'number' },
        zPx: { type: 'number' },
        heightPx: { type: 'number' },
        uMeters: { type: 'number' },
        vMeters: { type: 'number' },
        sizeUMeters: { type: 'number' },
        sizeVMeters: { type: 'number' },
        zMeters: { type: 'number' },
        heightMeters: { type: 'number' },
        stackOnBelow: { type: 'boolean' },
        ori: { type: 'number' },
        prismSides: { type: 'number' },
        triPrismCut: { type: 'string' },
        wedgeMode: { type: 'string' },
        domeMode: { type: 'string' },
        archPreset: { type: 'string' },
        archHollow: { type: 'boolean' },
        archHollowStyle: { type: 'string' },
        archInnerMode: { type: 'string' },
        archThickness: { type: 'number' },
        archNodes: { type: 'array', items: { type: 'object' } },
        archInnerNodes: { type: 'array', items: { type: 'object' } },
        loftPreset: { type: 'string' },
        topScale: { type: 'number' },
        loftInterp: { type: 'string' },
        loftHollow: { type: 'boolean' },
        loftFloorT: { type: 'number' },
        loftSections: { type: 'array', items: { type: 'object' } },
        baseColor: { type: 'string' },
        roofColor: { type: 'string' },
        autoShade: { type: 'boolean' },
        shadeContrast: { type: 'number', minimum: 0.3, maximum: 5 },
        outlineMode: { type: 'string' },
        outlineColor: { type: 'string' },
        edgeHighlight: { type: 'boolean' },
        pattern: { type: 'object' },
        visible: { type: 'boolean' },
        opacity: { type: 'number' },
        blend: { type: 'string' },
      },
    },
  },
  {
    name: 'studio_edit_structure',
    description:
      '[#M6] Fine parametric sub-structure editing on an existing arch, loft curved column, or multi-section column (box/prism/cylinder/vertical tri-prism): arch control nodes/slide rails, loft sections & transition planes, or column section taper/twist/edge bevels.',
    inputSchema: {
      type: 'object',
      required: ['subAction'],
      properties: {
        subAction: {
          type: 'string',
          enum: [
            'arch_preset',
            'arch_nodes',
            'arch_slide_node',
            'loft_add_section',
            'loft_update_section',
            'loft_delete_section',
            'col_enable',
            'col_add_section',
            'col_update_section',
            'col_update_edge',
          ],
        },
        layerId: { type: 'number' },
        layerName: { type: 'string' },
        layerIndex: { type: 'number' },
        preset: { type: 'string' },
        target: { type: 'string', enum: ['outer', 'inner'] },
        nodes: { type: 'array', items: { type: 'object' } },
        innerNodes: { type: 'array', items: { type: 'object' } },
        archHollow: { type: 'boolean' },
        archHollowStyle: { type: 'string', enum: ['shell', 'portal'] },
        archInnerMode: { type: 'string', enum: ['parallel', 'proportional', 'equal_vertical', 'custom'] },
        archThickness: { type: 'number' },
        nodeIndex: { type: 'number' },
        arcS: { type: 'number' },
        isInner: { type: 'boolean' },
        sectionId: { type: 'string' },
        sectionIndex: { type: 'number' },
        name: { type: 'string' },
        t: { type: 'number' },
        scale: { type: 'number' },
        twistDeg: { type: 'number' },
        offsetU: { type: 'number' },
        offsetV: { type: 'number' },
        isTransition: { type: 'boolean' },
        innerMode: { type: 'string', enum: ['parallel', 'proportional', 'custom'] },
        innerThickness: { type: 'number' },
        colInterp: { type: 'string', enum: ['smooth', 'linear'] },
        edgeIndex: { type: 'number' },
        offset: { type: 'number' },
        angleDeg: { type: 'number' },
        locked: { type: 'boolean' },
        pivotMidpoint: { type: 'boolean' },
      },
    },
  },
  {
    name: 'studio_texture_action',
    description:
      '[#M7] Manage planar face textures, custom pixel texture library & groups: inspect available faces (list_faces), import custom textures via spriteMatrix/local PNG/shear (import_asset), apply stretch/tile/cropped/mirrored face textures (set_face_texture), compose multi-decal custom faces (compose_face_decals), paint pixels directly on a textured model face (paint_face_pixels), or manage texture groups (manage_group).',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['list_faces', 'import_asset', 'set_face_texture', 'compose_face_decals', 'paint_face_pixels', 'manage_group'],
        },
        layerId: { type: 'number' },
        layerName: { type: 'string' },
        layerIndex: { type: 'number' },
        faceId: { type: 'string', description: 'Planar face id (e.g. wall_pv, wall_pu, top, slope_main, side_0).' },
        id: { type: 'string' },
        name: { type: 'string' },
        filePath: { type: 'string', description: 'Local PNG path for import_asset.' },
        spriteMatrix: {
          type: 'object',
          properties: {
            paletteSpec: { type: 'string', description: 'e.g. "W=#D8DEE9, G=#38BDF888, .=skip"' },
            palette: { type: 'object' },
            rows: { type: 'array', items: { type: 'string' } },
            scale: { type: 'number' },
          },
        },
        rgbaBase64: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        shear: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['up_right', 'down_right'] },
            step: { type: 'number' },
          },
        },
        displayForm: { type: 'string', enum: ['rect', 'parallelogram'] },
        groupId: { type: 'string' },
        groupName: { type: 'string' },
        mode: { type: 'string', enum: ['none', 'stretch', 'tile', 'custom'] },
        assetId: { type: 'string' },
        crop: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
        },
        tileScale: { type: 'number' },
        offsetX: { type: 'number' },
        offsetY: { type: 'number' },
        flipX: { type: 'boolean' },
        flipY: { type: 'boolean' },
        rot90: { type: 'number' },
        opacity: { type: 'number' },
        shadeWithFace: { type: 'boolean' },
        applyToAllSides: { type: 'boolean' },
        append: { type: 'boolean' },
        items: { type: 'array', items: { type: 'object' } },
        ops: { type: 'array', items: { type: 'object' }, description: 'Ops for paint_face_pixels: sprite_matrix, rect, pixels/stroke.' },
        assetName: { type: 'string' },
        op: { type: 'string', enum: ['create', 'rename', 'delete', 'move_asset'], description: 'Operation for manage_group.' },
      },
    },
  },
  {
    name: 'studio_get_preview',
    description:
      '[#M8] Capture a clean, gridless lossless PNG preview of the Blender Meow 3D scene (supports single/subset layers, 4-view horizontal strip, rotation override without mutating state, hiding theotown_base, and tight crop). Best for inspecting shading, silhouettes, proportions, and surface textures.',
    inputSchema: {
      type: 'object',
      properties: {
        viewRotation: { type: 'number', description: 'Optional temporary view rotation 0..3 (0/90/180/270deg).' },
        fourViews: { type: 'boolean', description: 'Render all 4 rotation viewpoints side by side.' },
        layerId: { type: 'number' },
        layerName: { type: 'string' },
        layerIds: { type: 'array', items: { type: 'number' } },
        layerNames: { type: 'array', items: { type: 'string' } },
        hideTheoTownBase: { type: 'boolean' },
        includeRasters: { type: 'boolean' },
        includeGroundShadow: { type: 'boolean' },
        includeInterBlockShadow: { type: 'boolean' },
        cropToContent: { type: 'boolean' },
        padding: { type: 'number' },
        scale: { type: 'number' },
        backdrop: { type: 'string', enum: ['gray', 'checker', 'dark', 'white', 'transparent'] },
        outputPath: { type: 'string' },
        includeImageBlock: { type: 'boolean' },
      },
    },
  },
  {
    name: 'studio_get_snapshot',
    description:
      '[#M9] Capture an annotated PNG snapshot WITH the 32x16 TheoTown isometric cell grid, plot frame outline, pixel (x,y) coordinate ruler, and optional active planar face highlight polygon. Supports zooming into sub-regions (x, y, w, h) for 1px inspection.',
    inputSchema: {
      type: 'object',
      properties: {
        viewRotation: { type: 'number' },
        layerId: { type: 'number' },
        layerName: { type: 'string' },
        layerIds: { type: 'array', items: { type: 'number' } },
        layerNames: { type: 'array', items: { type: 'string' } },
        hideTheoTownBase: { type: 'boolean' },
        includeRasters: { type: 'boolean' },
        includeGroundShadow: { type: 'boolean' },
        includeInterBlockShadow: { type: 'boolean' },
        cropToContent: { type: 'boolean' },
        padding: { type: 'number' },
        x: { type: 'number' },
        y: { type: 'number' },
        w: { type: 'number' },
        h: { type: 'number' },
        scale: { type: 'number' },
        backdrop: { type: 'string', enum: ['checker', 'gray', 'dark', 'white', 'transparent'] },
        highlightFaceId: { type: 'string' },
        outputPath: { type: 'string' },
        includeImageBlock: { type: 'boolean' },
      },
    },
  },
  {
    name: 'studio_handoff_to_pixelmeow',
    description:
      '[#M10] Seamlessly export Blender Meow layers directly into the Pixel Meow canvas plugin/app! Supports sending all 3D layers as an editable layered PSD (new project or merged layers into active canvas), selected/active layers only, a 4-view layered PSD (0/90/180/270deg as 4 layers), or a flat PNG overlay. Can also save a backup PSD/PNG copy into the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        exportScope: {
          type: 'string',
          enum: ['all_layers', 'selected_layers', 'four_views', 'flat_png'],
          description: 'What to send: all_layers (layered PSD, default), selected_layers (PSD of matching layerIds/layerNames or active), four_views (4-rotation layered PSD), or flat_png.',
        },
        importMode: {
          type: 'string',
          enum: ['new_project', 'as_layer', 'replace_active'],
          description: 'Pixel Meow import behavior: new_project (default for PSD), as_layer (merge layers / new layer in active Pixel Meow doc), or replace_active (PNG into active layer).',
        },
        layerIds: { type: 'array', items: { type: 'number' } },
        layerNames: { type: 'array', items: { type: 'string' } },
        activeOnly: { type: 'boolean' },
        scale: { type: 'number', description: 'Pixel upscale factor (default 1 for native TheoTown pixels).' },
        trim: { type: 'boolean', description: 'Trim surrounding empty margin (default true).' },
        includeRasters: { type: 'boolean', description: 'Include raster underlay/overlay layers (default false for clean 3D handoff).' },
        includeGroundShadow: { type: 'boolean', description: 'Include automatic 1:1 ground shadow layer (follows document setting by default).' },
        includeInterBlockShadow: { type: 'boolean', description: 'Include experimental 1:1 inter-block cast shadow layer.' },
        hideTheoTownBase: { type: 'boolean', description: 'Hide theotown_base tiles during export (recommended true before final pixel painting / 4-view export).' },
        excludeTheoTownBase: { type: 'boolean', description: 'Omit theotown_base layers completely.' },
        projectName: { type: 'string' },
        layerName: { type: 'string' },
        x: { type: 'number', description: 'Paste X offset when sending flat_png.' },
        y: { type: 'number', description: 'Paste Y offset when sending flat_png.' },
        saveWorkspaceCopyPath: { type: 'string', description: 'Optional relative/absolute path inside workspace to also write the exported .psd/.png file.' },
        autoOpenPixelMeow: { type: 'boolean', description: 'Auto-launch Pixel Meow hub/window if no canvas is connected (default false in Sidecar mode unless needed).' },
      },
    },
  },
];

async function handleToolCall(name, args = {}) {
  switch (name) {
    case 'studio_open': {
      const hub = await getActiveHub();
      const autoOpen = args.autoOpen !== undefined ? Boolean(args.autoOpen) : defaultAutoOpen();
      const res = await forwardToHub(hub.port, '/open', 'POST', { autoOpen });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ...res.data,
                sidecarLink: '[Blender Meow 建模坊](sidecar://blender-meow/blender_studio/ui.html)',
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    case 'studio_get_state': {
      const res = await callHubExec({ kind: 'get_state' });
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    case 'studio_doc_action': {
      const action = String(args.action || '');
      if (action === 'export_psd') {
        const res = await callHubExec({
          kind: 'doc_action',
          action: 'export_psd_base64',
          scale: args.scale ?? 1,
          trim: args.trim !== false,
          includeRasters: args.includeRasters !== false,
          includeGroundShadow: args.includeGroundShadow,
          includeInterBlockShadow: args.includeInterBlockShadow,
          fourViews: Boolean(args.fourViews),
          hideTheoTownBase: Boolean(args.hideTheoTownBase),
          excludeTheoTownBase: Boolean(args.excludeTheoTownBase),
          activeOnly: Boolean(args.activeOnly),
          layerIds: args.layerIds,
          layerNames: args.layerNames,
        });
        const safeDoc = String(res.docName || 'blender_meow').replace(/[\\/:*?"<>|]/g, '_').trim() || 'blender_meow';
        const suffix = args.fourViews ? '_4views.psd' : '.psd';
        const resolved = await resolveMcpFilePath(args.filePath, `${safeDoc}${suffix}`);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        const buf = Buffer.from(String(res.psdBase64 || ''), 'base64');
        fs.writeFileSync(resolved, buf);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  exported: true,
                  format: 'psd',
                  fourViews: Boolean(args.fourViews),
                  filePath: toForwardSlashes(resolved),
                  width: res.width,
                  height: res.height,
                  scale: res.scale,
                  layerCount: res.layerCount,
                  bytes: buf.length,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (action === 'export_png') {
        const res = await callHubExec({
          kind: 'doc_action',
          action: 'export_png_base64',
          scale: args.scale ?? 1,
          trim: args.trim !== false,
          includeRasters: args.includeRasters !== false,
          includeGroundShadow: args.includeGroundShadow,
          includeInterBlockShadow: args.includeInterBlockShadow,
          fourViews: Boolean(args.fourViews),
          hideTheoTownBase: args.hideTheoTownBase,
          excludeTheoTownBase: Boolean(args.excludeTheoTownBase),
          activeOnly: Boolean(args.activeOnly),
          layerIds: args.layerIds,
          layerNames: args.layerNames,
        });
        const safeDoc = String(res.docName || 'blender_meow').replace(/[\\/:*?"<>|]/g, '_').trim() || 'blender_meow';
        const suffix = args.fourViews ? '_4views.png' : '.png';
        const resolved = await resolveMcpFilePath(args.filePath, `${safeDoc}${suffix}`);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        const buf = Buffer.from(String(res.pngBase64 || ''), 'base64');
        fs.writeFileSync(resolved, buf);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  exported: true,
                  format: 'png',
                  fourViews: Boolean(args.fourViews),
                  filePath: toForwardSlashes(resolved),
                  width: res.width,
                  height: res.height,
                  bytes: buf.length,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (action === 'export_bmeow') {
        const res = await callHubExec({ kind: 'doc_action', action: 'export_bmeow_json' });
        const safeDoc = String(res.docName || 'blender_meow').replace(/[\\/:*?"<>|]/g, '_').trim() || 'blender_meow';
        const resolved = await resolveMcpFilePath(args.filePath, `${safeDoc}.bmeow`);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, String(res.json || ''), 'utf8');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  exported: true,
                  format: 'bmeow',
                  filePath: toForwardSlashes(resolved),
                  bytes: Buffer.byteLength(String(res.json || ''), 'utf8'),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (action === 'import_psd') {
        const rawPath = String(args.filePath || '').trim();
        if (!rawPath) throw new Error('import_psd requires filePath');
        const resolved = await resolveMcpFilePath(rawPath);
        if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
        const psdBase64 = fs.readFileSync(resolved).toString('base64');
        const res = await callHubExec({ kind: 'doc_action', action: 'import_psd_base64', psdBase64 });
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }

      if (action === 'import_bmeow') {
        const rawPath = String(args.filePath || '').trim();
        if (!rawPath) throw new Error('import_bmeow requires filePath');
        const resolved = await resolveMcpFilePath(rawPath);
        if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
        const json = fs.readFileSync(resolved, 'utf8');
        const res = await callHubExec({
          kind: 'doc_action',
          action: 'import_bmeow_json',
          json,
          name: args.name,
        });
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }

      const res = await callHubExec({ kind: 'doc_action', ...args });
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    case 'studio_layer_action': {
      if (args.action === 'add_raster') {
        const rawPath = String(args.filePath || '').trim();
        if (!rawPath) throw new Error('add_raster requires filePath');
        const resolved = await resolveMcpFilePath(rawPath);
        if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
        const pngBase64 = fs.readFileSync(resolved).toString('base64');
        const res = await callHubExec({
          kind: 'layer_action',
          action: 'add_raster_png_base64',
          pngBase64,
          name: args.name || path.basename(resolved, path.extname(resolved)),
          rasterRole: args.rasterRole || 'underlay',
        });
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      const res = await callHubExec({ kind: 'layer_action', ...args });
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    case 'studio_upsert_shape': {
      const res = await callHubExec({ kind: 'upsert_shape', ...args });
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    case 'studio_edit_structure': {
      const res = await callHubExec({ kind: 'edit_structure', ...args });
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    case 'studio_texture_action': {
      const payload = { kind: 'texture_action', ...args };
      if (args.action === 'import_asset' && typeof args.filePath === 'string' && args.filePath.trim()) {
        const resolved = await resolveMcpFilePath(args.filePath);
        if (!fs.existsSync(resolved)) throw new Error(`Texture file not found: ${resolved}`);
        payload.pngBase64 = fs.readFileSync(resolved).toString('base64');
        if (!payload.name) {
          payload.name = path.basename(resolved, path.extname(resolved));
        }
      }
      const res = await callHubExec(payload);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    case 'studio_get_preview':
    case 'studio_get_snapshot': {
      ensureDirs();
      const isSnap = name === 'studio_get_snapshot';
      const res = await callHubExec({
        kind: 'get_snapshot',
        ...args,
        grid: isSnap,
        backdrop: args.backdrop || (isSnap ? 'checker' : 'gray'),
      });
      const b64 = String(res.pngBase64 || '');
      const defaultName = `${isSnap ? 'snap' : 'preview'}_${Date.now()}.png`;
      const outPath = args.outputPath
        ? await resolveMcpFilePath(String(args.outputPath))
        : path.join(SNAPSHOT_DIR, defaultName);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      if (b64) {
        fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
      }
      const { pngBase64: _drop, ...meta } = res;
      const summary = {
        viewKind: isSnap ? 'annotated_isometric_grid' : 'gridless_preview',
        snapshotPath: toForwardSlashes(outPath),
        ...meta,
      };
      const content = [{ type: 'text', text: JSON.stringify(summary, null, 2) }];
      if (args.includeImageBlock !== false && b64) {
        content.push({ type: 'image', data: b64, mimeType: 'image/png' });
      }
      return { content };
    }

    case 'studio_handoff_to_pixelmeow': {
      const exportScope = String(args.exportScope || 'all_layers');
      const isPng = exportScope === 'flat_png';
      const isFourViews = exportScope === 'four_views';
      const isSelected = exportScope === 'selected_layers';
      const scale = args.scale ?? 1;
      const trim = args.trim !== false;
      const includeRasters = Boolean(args.includeRasters);
      const hideTheoTownBase = args.hideTheoTownBase !== undefined
        ? Boolean(args.hideTheoTownBase)
        : (isPng || isFourViews);

      const exported = await callHubExec({
        kind: 'doc_action',
        action: isPng ? 'export_png_base64' : 'export_psd_base64',
        scale,
        trim,
        includeRasters,
        includeGroundShadow: args.includeGroundShadow,
        includeInterBlockShadow: args.includeInterBlockShadow,
        fourViews: isFourViews,
        hideTheoTownBase,
        excludeTheoTownBase: Boolean(args.excludeTheoTownBase),
        activeOnly: Boolean(args.activeOnly) || (isSelected && !args.layerIds && !args.layerNames),
        layerIds: isSelected ? args.layerIds : undefined,
        layerNames: isSelected ? args.layerNames : undefined,
      });

      const docTitle = String(args.projectName || exported.docName || 'BlenderMeow_Model');
      const dataBase64 = String(isPng ? (exported.pngBase64 || '') : (exported.psdBase64 || ''));
      if (!dataBase64) {
        throw new Error('Export produced empty image/PSD payload');
      }

      let workspaceCopyPath = null;
      if (typeof args.saveWorkspaceCopyPath === 'string' && args.saveWorkspaceCopyPath.trim()) {
        const resolvedCopy = await resolveMcpFilePath(args.saveWorkspaceCopyPath);
        fs.mkdirSync(path.dirname(resolvedCopy), { recursive: true });
        fs.writeFileSync(resolvedCopy, Buffer.from(dataBase64, 'base64'));
        workspaceCopyPath = toForwardSlashes(resolvedCopy);
      }

      const defaultImportMode = isPng ? 'as_layer' : (isSelected ? 'as_layer' : 'new_project');
      const importMode = args.importMode || defaultImportMode;
      const handoffRes = await handoffToPixelMeowHub({
        format: isPng ? 'png' : 'psd',
        dataBase64,
        projectName: docTitle,
        layerName: args.layerName || (isSelected ? docTitle : '3D 建模图层'),
        importMode,
        x: args.x ?? 0,
        y: args.y ?? 0,
        autoOpenPixelMeow: args.autoOpenPixelMeow !== undefined ? Boolean(args.autoOpenPixelMeow) : false,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                exportScope,
                format: isPng ? 'png' : 'psd',
                importMode,
                width: exported.width,
                height: exported.height,
                layerCount: exported.layerCount ?? 1,
                workspaceCopyPath,
                ...handoffRes,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleRpc(msg) {
  const { id, method, params } = msg || {};
  try {
    if (method === 'initialize') {
      const reqProto = params?.protocolVersion || '2024-11-05';
      sendResult(id, {
        protocolVersion: reqProto,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'blendermeow-studio-mcp', version: HUB_VERSION },
      });
      return;
    }

    if (method === 'notifications/initialized' || method === 'initialized') {
      return;
    }

    if (method === 'ping') {
      sendResult(id, {});
      return;
    }

    if (method === 'tools/list') {
      sendResult(id, { tools: TOOLS });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};
      const out = await handleToolCall(toolName, args);
      sendResult(id, out);
      return;
    }

    if (id !== undefined && id !== null) {
      sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    if (method === 'tools/call') {
      sendResult(id, {
        isError: true,
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
      });
    } else if (id !== undefined && id !== null) {
      sendError(id, -32000, err instanceof Error ? err.message : String(err));
    }
  }
}

let rawBuf = Buffer.alloc(0);

function processBuffer() {
  while (rawBuf.length > 0) {
    const headStr = rawBuf.toString('utf8', 0, Math.min(rawBuf.length, 64));
    if (headStr.startsWith('Content-Length:')) {
      framingMode = 'lsp';
      const headerEnd = rawBuf.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const headerText = rawBuf.toString('utf8', 0, headerEnd);
      const match = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!match) {
        rawBuf = rawBuf.subarray(headerEnd + 4);
        continue;
      }
      const bodyLen = Number(match[1]);
      const totalLen = headerEnd + 4 + bodyLen;
      if (rawBuf.length < totalLen) return;
      const jsonStr = rawBuf.toString('utf8', headerEnd + 4, totalLen);
      rawBuf = rawBuf.subarray(totalLen);
      if (jsonStr.trim()) {
        try {
          void handleRpc(JSON.parse(jsonStr));
        } catch (err) {
          sendError(null, -32700, 'Parse error: ' + String(err));
        }
      }
      continue;
    }

    const nlIdx = rawBuf.indexOf('\n');
    if (nlIdx === -1) return;
    const line = rawBuf.toString('utf8', 0, nlIdx).trim();
    rawBuf = rawBuf.subarray(nlIdx + 1);
    if (!line) continue;
    try {
      void handleRpc(JSON.parse(line));
    } catch (err) {
      sendError(null, -32700, 'Parse error: ' + String(err));
    }
  }
}

process.stdin.on('data', (chunk) => {
  const bufChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  rawBuf = Buffer.concat([rawBuf, bufChunk]);
  processBuffer();
});

process.stdin.on('end', async () => {
  if (hubHandle?.ownsServer && typeof hubHandle.close === 'function') {
    await hubHandle.close();
  }
  process.exit(0);
});
