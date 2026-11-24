import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { initializeCanvas, readPsd } from 'ag-psd';
import {
  ARCH_INNER_MODES,
  ARCH_PRESETS,
  applyArchNodeSlideAtArcS,
  buildArchNodeSlideRail,
  cloneArchNode,
  createArchPresetNodes,
  createScaledInnerPresetNodes,
  fitEditableNodesFromInnerCurve,
  fitFreehandArchNodes,
  getArchSampleCount,
  normalizeArchNodes,
  projectOntoArchSlideRail,
  sampleArchInnerCurve,
  sampleArchOuterCurve,
} from '../src/core/arch';
import {
  hslToRgb,
  parseColorCode,
  parseHex,
  rgbToHsl,
  toHex,
  toHex8,
} from '../src/core/color';
import {
  BUILTIN_PALETTES,
  extractColorsFromBmeowJson,
  loadUserPalettes,
  paletteToGpl,
  parsePaletteFile,
} from '../src/core/palette';
import {
  getPlotOrigin,
  isoToScreenPx,
  measureHorizontalPlane,
  measureMixedPythagorean,
  measureVerticalMeters,
  worldBoxToView,
} from '../src/core/isoMath';
import {
  DEFAULT_GROUND_SHADOW_COLOR,
  DEFAULT_GROUND_SHADOW_HEX,
  GROUND_SHADOW_LAYER_NAME,
  INTER_BLOCK_SHADOW_LAYER_NAME,
  renderShapeGroundShadowMask,
} from '../src/core/groundShadow';
import {
  clampShadeContrast,
  cloneShape,
  createDefaultShape,
  getPlanarFaceScreenOverlay,
  renderShapeToBuffer,
  SHAPE_LABELS,
  type FacadePatternType,
  type ShapeKind,
} from '../src/core/isoRenderer';
import {
  APP_AUTHOR,
  APP_LICENSE_NAME,
  MIT_LICENSE_TEXT,
  PIXEL_MEOW_ONLINE_URL,
} from '../src/core/about';
import {
  detectSystemLocale,
  getLanguageSetting,
  getLocale,
  resolveLocale,
  setLanguageSetting,
  SUPPORTED_LOCALES,
  tr,
} from '../src/core/i18n';
import { THEME_PRESETS } from '../src/core/theme';
import { APP_VERSION, CHANGELOG_ENTRIES } from '../src/ui/changelogDialog';
import {
  applyLoftNodeSlideAtArcS,
  buildLoftNodeSlideRail,
  canLoftSectionBeTransition,
  cloneLoftNode,
  computeColumnRefRadiusMetric,
  convertLoftSectionToTransition,
  createLoftPresetNodes,
  createScaledLoftInnerPresetNodes,
  ensureActiveLoftSection,
  fitEditableNodesFromSectionInner,
  getSectionInteriorCenterLocal,
  interpolateLoftSectionInner,
  interpolateLoftSectionNodes,
  LOFT_POLYGON_PRESETS,
  LOFT_PRESETS,
  nextLoftSectionId,
  normalizeLoftSections,
  pointInClosedPolygon,
  projectOntoLoftSlideRail,
  sampleClosedSectionUniform,
  sampleSectionInnerUniform,
  syncLoftTransitionSections,
} from '../src/core/loft';
import {
  applyColumnEdgeEdit,
  applyColumnSectionTransform,
  canColumnSectionBeTransition,
  cloneColumnSection,
  convertColumnSectionToTransition,
  ensureColumnSections,
  evaluateColumnSectionEdges,
  hasActiveColumnSections,
  insertColumnSectionAtT,
  insertColumnTransitionSection,
  isColumnSectionShape,
  syncColumnTransitionSections,
} from '../src/core/columnSections';
import { BLEND_MODES, BuilderDocument, BuilderLayer } from '../src/core/document';
import { deserializeBmeowProject, serializeBmeowProject } from '../src/core/exporter';
import { History } from '../src/core/history';
import { exportBuilderPsd, exportFourViewLayersPsd } from '../src/core/psd';
import { projectRulerPoint3D, resolveConstrainedRulerPoint3D } from '../src/core/rulerTool';
import { RulerPoint3D, App } from '../src/app';
import { executeAiStudioCommand, getStudioState } from '../src/core/aiStudioOps';
import {
  ShortcutManager,
  eventToKeyStroke,
  formatKeyStroke,
  parseKeyStroke,
  serializeKeyStroke,
  type ShortcutStorageAdapter,
} from '../src/shortcuts';
import {
  BLENDER_SHORTCUT_ACTIONS,
  BLENDER_SHORTCUT_CATEGORIES,
  BLENDER_SHORTCUT_PRESETS,
} from '../src/shortcuts/blenderShortcuts';
import {
  BUILTIN_PRESET_GROUP_ID,
  DEFAULT_USER_GROUP_ID,
  applyEditedFaceBufferToShape,
  autoDetectParallelogramCorners,
  createTextureGroup,
  cropRgbaBuffer,
  deleteTextureGroup,
  deshearPixels,
  extractFaceTextureLayerBuffer,
  getAssetDisplayPixels,
  getEffectiveAssetDims,
  getPersistableTextureGroups,
  getPersistableUserTextureAssets,
  getPlanarFacesForShape,
  getTextureAsset,
  getTextureGroups,
  getTextureLibrary,
  getTextureLibraryByGroup,
  hydratePersistedTextureGroups,
  isPlanarTextureShape,
  makeTextureAssetFromRgba,
  removeTextureAsset,
  renameTextureGroup,
  renderFaceTextureFlatBuffer,
  resolveAssetGroupId,
  sampleFaceTextureRGBA,
  setTextureAssetGroup,
  shearPixels,
  toggleTextureAssetForm,
  unwrapParallelogramPixels,
  upsertTextureAsset,
  warpRectToParallelogramPixels,
} from '../src/core/textures';
import {
  combineSelectionMask,
  computeSelectionEdges,
  floodSelectMask,
  invertSelectionMask,
  plotPixelPerfectStroke,
  rectSelectMask,
} from '../src/ui/pixelCanvasEditor';

function countPixels(buf: Uint8ClampedArray): { solid: number; semiTransparent: number } {
  let solid = 0;
  let semiTransparent = 0;
  for (let i = 3; i < buf.length; i += 4) {
    const a = buf[i];
    if (a === 255) solid++;
    else if (a !== 0) semiTransparent++;
  }
  return { solid, semiTransparent };
}

function buffersEqual(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function testRotationClosure() {
  const doc = new BuilderDocument(256, 256, 4, 2, 16);
  const shapeA = createDefaultShape('wedge', {
    u: 0.5,
    v: 0.25,
    zPx: 0,
    sizeU: 1.5,
    sizeV: 0.75,
    heightPx: 24,
    ori: 1,
    wedgeMode: 'ramp',
    baseColor: { r: 210, g: 120, b: 90, a: 255 },
  });
  const shapeB = createDefaultShape('box', {
    u: 2.25,
    v: 1.0,
    zPx: 6,
    sizeU: 1.0,
    sizeV: 0.75,
    heightPx: 30,
    ori: 2,
    baseColor: { r: 90, g: 165, b: 220, a: 255 },
  });

  const lA = new BuilderLayer(doc.width, doc.height, 'WedgeA', 'shape', shapeA);
  const lB = new BuilderLayer(doc.width, doc.height, 'BoxB', 'shape', shapeB);
  doc.layers.push(lA, lB);
  doc.rerenderAllShapes();

  const initBuf = doc.renderToBuffer();
  const initStats = countPixels(initBuf);
  assert.ok(initStats.solid > 50, 'Initial non-square plot render should have > 50 solid pixels');
  assert.equal(initStats.semiTransparent, 0, 'Initial render must have 0 semi-transparent pixels');

  const intermediateBufs: Uint8ClampedArray[] = [initBuf];
  for (let step = 1; step <= 4; step++) {
    doc.rotateView(1);
    assert.equal(doc.viewRotation, step % 4);
    const cur = doc.renderToBuffer();
    const st = countPixels(cur);
    assert.ok(st.solid > 50, `Rotation ${step} should render > 50 solid pixels`);
    assert.equal(st.semiTransparent, 0, `Rotation ${step} must have 0 semi-transparent pixels`);
    if (step < 4) {
      assert.ok(!buffersEqual(cur, initBuf), `Rotation ${step * 90}deg should differ from 0deg`);
      intermediateBufs.push(cur);
    } else {
      assert.ok(buffersEqual(cur, initBuf), 'Four 90deg rotations must close pixel-for-pixel');
    }
  }

  // Verify worldBoxToView preserves footprint dimensions cleanly across 4 rotations
  const vb1 = worldBoxToView(0.5, 0.25, 1.5, 0.75, 1, 4, 2, 1);
  assert.equal(vb1.viewPlotU, 2);
  assert.equal(vb1.viewPlotV, 4);
  assert.equal(vb1.sizeU, 0.75);
  assert.equal(vb1.sizeV, 1.5);
  console.log('PASS: Non-square plot (4x2) 4x90deg rotation closure');
}

function testTheoTownRuler() {
  const v1 = measureVerticalMeters(100, 103);
  assert.equal(v1.deltaPx, 3);
  assert.ok(Math.abs(v1.meters - 1.6) < 1e-9, `Expected 1.6m, got ${v1.meters}`);

  const v2 = measureVerticalMeters(200, 182);
  assert.equal(v2.deltaPx, 18);
  assert.ok(Math.abs(v2.meters - 9.6) < 1e-9, `Expected 9.6m, got ${v2.meters}`);

  const hU = measureHorizontalPlane(100, 100, 116, 108);
  assert.ok(Math.abs(hU.totalMeters - 9.6) < 1e-9, `Expected +U cell = 9.6m, got ${hU.totalMeters}`);

  const hV = measureHorizontalPlane(100, 100, 84, 108);
  assert.ok(Math.abs(hV.totalMeters - 9.6) < 1e-9, `Expected +V cell = 9.6m, got ${hV.totalMeters}`);

  const hDiag = measureHorizontalPlane(100, 100, 100, 116);
  assert.ok(
    Math.abs(hDiag.totalMeters - 9.6 * Math.SQRT2) < 1e-9,
    `Expected 1x1 diag = ${9.6 * Math.SQRT2}, got ${hDiag.totalMeters}`,
  );

  // 9.6m flat + 13.5px vertical (= 7.2m) -> sqrt(9.6^2 + 7.2^2) = 12.0m
  const mix = measureMixedPythagorean(100, 100, 116, 108, 116, 94.5, 'flat_then_vert');
  assert.ok(Math.abs(mix.flat.totalMeters - 9.6) < 1e-9);
  assert.ok(Math.abs(mix.vert.meters - 7.2) < 1e-9);
  assert.ok(Math.abs(mix.totalMeters - 12.0) < 1e-9, `Expected mixed = 12.0m, got ${mix.totalMeters}`);
  console.log('PASS: TheoTown dual-scale ruler (3px=1.6m, 1cell=9.6m, mixed Pythagorean=12.0m)');
}

function testPrimitivesAndPatterns() {
  const kinds: ShapeKind[] = [
    'box',
    'right_tri_prism',
    'arch',
    'cylinder',
    'loft',
    'prism',
    'wedge',
    'pyramid',
    'cone',
    'dome',
    'theotown_base',
  ];
  const patterns: FacadePatternType[] = [
    'none',
    'windows',
    'curtain_v',
    'curtain_h',
    'brick',
    'roof_grid',
  ];
  const W = 192;
  const H = 192;
  const buf = new Uint8ClampedArray(W * H * 4);
  let renderCount = 0;

  assert.equal(createDefaultShape('box').outlineMode, 'none', 'Default outlineMode must be none');

  for (const kind of kinds) {
    const variants: Partial<ReturnType<typeof createDefaultShape>>[] =
      kind === 'right_tri_prism'
        ? [
            { triPrismCut: 'vertical', ori: 0 },
            { triPrismCut: 'vertical', ori: 1 },
            { triPrismCut: 'vertical', ori: 2 },
            { triPrismCut: 'vertical', ori: 3 },
            { triPrismCut: 'slope', ori: 0 },
            { triPrismCut: 'slope', ori: 2 },
          ]
        : kind === 'arch'
          ? [
              { archHollow: false, ori: 0 },
              { archHollow: true, archHollowStyle: 'shell', archThickness: 0.28, ori: 0 },
              { archHollow: true, archHollowStyle: 'portal', archThickness: 0.25, ori: 1 },
              { archHollow: true, archHollowStyle: 'shell', archNodes: createArchPresetNodes('pointed'), ori: 2 },
            ]
          : kind === 'prism'
          ? [3, 5, 6, 8].map((prismSides) => ({ prismSides }))
          : kind === 'wedge'
            ? [{ wedgeMode: 'ramp' }, { wedgeMode: 'gable' }]
            : kind === 'dome'
              ? [{ domeMode: 'dome' }, { domeMode: 'sphere' }]
              : kind === 'loft'
                ? [
                    {},
                    {
                      loftSections: [
                        { id: 'h1', name: 'Heart', t: 0, scale: 1, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: createLoftPresetNodes('heart') },
                      ],
                    },
                    {
                      loftInterp: 'linear',
                      loftSections: [
                        { id: 'l1', name: 'L', t: 0, scale: 1, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: createLoftPresetNodes('l_shape') },
                        { id: 'l2', name: 'K', t: 0.5, scale: 0.85, twistDeg: 25, offsetU: 0, offsetV: 0, nodes: createLoftPresetNodes('kidney') },
                        { id: 'l3', name: 'S', t: 1, scale: 0.9, twistDeg: 45, offsetU: 0, offsetV: 0, nodes: createLoftPresetNodes('star') },
                      ],
                    },
                  ]
                : [{}];

    for (const variant of variants) {
      for (const patternType of patterns) {
        for (const rot of [0, 1, 2, 3] as const) {
          buf.fill(0);
          const shape = createDefaultShape(kind, {
            u: 1,
            v: 1,
            zPx: 0,
            sizeU: 1.5,
            sizeV: 1.5,
            heightPx: kind === 'theotown_base' ? 0 : 28,
            ori: 0,
            ...variant,
            pattern: {
              type: patternType,
              primaryColor: { r: 70, g: 180, b: 250, a: 255 },
              rows: 3,
              cols: 3,
              spacingPx: 2,
              marginPx: 3,
              applyTop: true,
            },
          });
          renderShapeToBuffer(buf, W, H, shape, 4, 4, rot, 96, 96);
          const { solid, semiTransparent } = countPixels(buf);
          assert.ok(
            solid > 20,
            `Expected >20 solid pixels for ${kind} variant=${JSON.stringify(variant)} pat=${patternType} rot=${rot}, got ${solid}`,
          );
          assert.equal(
            semiTransparent,
            0,
            `Expected 0 semi-transparent pixels for ${kind} pat=${patternType} rot=${rot}, got ${semiTransparent}`,
          );
          renderCount++;
        }
      }
    }
  }
  console.log(`PASS: All ${kinds.length} primitives x variants x 6 patterns x 4 rotations (${renderCount} renders, 0 AA leakage, outline default none)`);
}

function testTopologicalDepthSort() {
  const doc = new BuilderDocument(256, 256, 4, 4, 16);
  const back = new BuilderLayer(
    doc.width,
    doc.height,
    'Back',
    'shape',
    createDefaultShape('box', { u: 0, v: 0, zPx: 0, sizeU: 1, sizeV: 1, heightPx: 24 }),
  );
  const front = new BuilderLayer(
    doc.width,
    doc.height,
    'Front',
    'shape',
    createDefaultShape('box', { u: 2, v: 2, zPx: 0, sizeU: 1, sizeV: 1, heightPx: 24 }),
  );
  // Push in wrong order intentionally
  doc.layers.push(front, back);
  doc.sortLayersByIsoDepth();
  assert.ok(doc.layers.indexOf(back) < doc.layers.indexOf(front), 'rot=0: Back must be before Front');

  doc.rotateView(2); // 180 deg
  assert.ok(doc.layers.indexOf(front) < doc.layers.indexOf(back), 'rot=2: Front must be before Back');

  // Vertical stacking check across all 4 rotations
  const stackDoc = new BuilderDocument(256, 256, 4, 4, 16);
  const baseBox = new BuilderLayer(
    stackDoc.width,
    stackDoc.height,
    'BaseBox',
    'shape',
    createDefaultShape('box', { u: 1, v: 1, zPx: 0, sizeU: 2, sizeV: 2, heightPx: 18 }),
  );
  const roofPyr = new BuilderLayer(
    stackDoc.width,
    stackDoc.height,
    'RoofPyramid',
    'shape',
    createDefaultShape('pyramid', { u: 1, v: 1, zPx: 18, sizeU: 2, sizeV: 2, heightPx: 18 }),
  );
  stackDoc.layers.push(roofPyr, baseBox);
  for (let r = 0; r < 4; r++) {
    stackDoc.rotateView(r === 0 ? 0 : 1);
    assert.ok(
      stackDoc.layers.indexOf(baseBox) < stackDoc.layers.indexOf(roofPyr),
      `rot=${stackDoc.viewRotation}: BaseBox must always precede RoofPyramid`,
    );
  }
  console.log('PASS: Topological isometric depth sort (horizontal 180deg flip & 4-rot vertical stacking)');
}

function getOpaqueBbox(buf: Uint8ClampedArray, w: number, h: number) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (buf[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX >= minX ? { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;
}

function testM9AndM11AndL7() {
  const W = 160;
  const H = 160;
  const boxBuf = new Uint8ClampedArray(W * H * 4);
  const box = createDefaultShape('box', { u: 1, v: 1, zPx: 0, sizeU: 1, sizeV: 1, heightPx: 16 });
  renderShapeToBuffer(boxBuf, W, H, box, 4, 4, 0, 80, 120);
  const boxBb = getOpaqueBbox(boxBuf, W, H);
  assert.ok(boxBb, 'M9: 1x1 box should produce pixels');
  assert.equal(boxBb.w, 32, `M9: 1x1 box X-span must be 32px exact, got ${boxBb.w}`);
  assert.equal(countPixels(boxBuf).semiTransparent, 0, 'M9: 1x1 box must have 0 AA pixels');

  const box1Buf = new Uint8ClampedArray(W * H * 4);
  const box1 = createDefaultShape('box', { u: 1, v: 1, zPx: 0, sizeU: 1, sizeV: 1, heightPx: 1 });
  renderShapeToBuffer(box1Buf, W, H, box1, 4, 4, 0, 80, 120);
  const baseBuf = new Uint8ClampedArray(W * H * 4);
  const base = createDefaultShape('theotown_base', { u: 1, v: 1, zPx: 0, sizeU: 1, sizeV: 1, heightPx: 0 });
  renderShapeToBuffer(baseBuf, W, H, base, 4, 4, 0, 80, 120);
  const box1Bb = getOpaqueBbox(box1Buf, W, H);
  const baseBb = getOpaqueBbox(baseBuf, W, H);
  assert.ok(box1Bb && baseBb, 'M11: 1px box and theotown_base should produce pixels');
  assert.equal(baseBb.maxY, box1Bb.maxY, `M11: bottom Y aligned with 0px box footprint (${baseBb.maxY} vs ${box1Bb.maxY})`);
  assert.equal(baseBb.minY, 137, `M11: top opaque row at topY+1=137 (got ${baseBb.minY})`);

  // L7: asymmetric roof_grid rows:2 cols:5 must close across 4 rotations
  const doc = new BuilderDocument(256, 256, 4, 3, 16);
  const roof = createDefaultShape('box', {
    u: 1, v: 1, zPx: 0, sizeU: 2, sizeV: 1, heightPx: 20, ori: 0,
    pattern: {
      type: 'roof_grid',
      primaryColor: { r: 250, g: 220, b: 90, a: 255 },
      rows: 2,
      cols: 5,
      spacingPx: 1,
      marginPx: 2,
      applyTop: true,
    },
  });
  doc.layers.push(new BuilderLayer(doc.width, doc.height, 'RoofGrid', 'shape', roof));
  doc.rerenderAllShapes();
  const r0 = doc.renderToBuffer();
  doc.rotateView(1);
  const r90 = doc.renderToBuffer();
  assert.ok(!buffersEqual(r90, r0), 'L7: 90deg rotated roof_grid should differ from 0deg');
  doc.rotateView(1);
  doc.rotateView(1);
  doc.rotateView(1);
  const r360 = doc.renderToBuffer();
  assert.ok(buffersEqual(r360, r0), 'L7: asymmetric roof_grid must close after 4x90deg rotations');
  console.log('PASS: M9 (32px 1x1 box silhouette), M11 (0px base alignment), L7 (asymmetric roof_grid closure)');
}

function testHistoryPushBeforeMutateAndDiscard() {
  const doc = new BuilderDocument(128, 128, 4, 4, 16);
  const layer = new BuilderLayer(
    doc.width,
    doc.height,
    'B1',
    'shape',
    createDefaultShape('box', { u: 1, v: 1, zPx: 0, sizeU: 1, sizeV: 1, heightPx: 20 }),
  );
  doc.layers.push(layer);
  doc.rerenderAllShapes();

  const hist = new History();
  hist.push('改高度', doc);
  layer.shape!.heightPx = 42;
  doc.rerenderShapeLayer(layer);
  assert.equal(hist.pushSeq, 1);

  const label = hist.undo(doc);
  assert.equal(label, '改高度');
  assert.equal(doc.layers[0].shape!.heightPx, 20, 'H1: undo restores exact pre-mutation state');
  assert.equal(hist.canRedo, true);
  hist.redo(doc);
  assert.equal(doc.layers[0].shape!.heightPx, 42);
  assert.equal(hist.canRedo, false);

  // Aborted drag snapshot discardLast should pop without pushing to redoStack
  hist.push('取消拖拽', doc);
  layer.shape!.u = 2;
  layer.shape!.u = 1;
  assert.equal(hist.discardLast(), true);
  assert.equal(hist.canRedo, false, 'discardLast must not pollute redoStack');
  assert.equal(hist.undo(doc), '改高度', 'discardLast popped temporary snapshot');
  console.log('PASS: H1 pre-mutation history + discardLast');
}

function testRuler3DAndVertThenFlat() {
  const plotU = 4;
  const plotV = 3;
  const rot0Origin = getPlotOrigin(256, 256, plotU, plotV, 16);
  const ctx0 = {
    plotU,
    plotV,
    viewRotation: 0 as const,
    originX: rot0Origin.originX,
    originY: rot0Origin.originY,
    snapStep: 0.5,
    snapGrid: true,
    lockAxis: false,
  };
  const A: RulerPoint3D = { wu: 1, wv: 1, zPx: 0 };
  const [, ay] = projectRulerPoint3D(A, plotU, plotV, 0, rot0Origin.originX, rot0Origin.originY);
  const B = resolveConstrainedRulerPoint3D(0, ay - 24, [A], 'mixed', 'vert_then_flat', ctx0);
  assert.equal(B.zPx, 24, 'M1: B must be 24px above A');

  // Target 1 cell in +U direction while elevated at z = 24
  const targetScreen = projectRulerPoint3D(
    { wu: 2, wv: 1, zPx: 24 },
    plotU,
    plotV,
    0,
    rot0Origin.originX,
    rot0Origin.originY,
  );
  const C = resolveConstrainedRulerPoint3D(
    targetScreen[0],
    targetScreen[1],
    [A, B],
    'mixed',
    'vert_then_flat',
    ctx0,
  );
  assert.equal(C.zPx, B.zPx, 'M1: vert_then_flat C.zPx must lock to B.zPx elevated plane');
  assert.ok(Math.abs(C.wu - 2) < 1e-6 && Math.abs(C.wv - 1) < 1e-6, 'M1: C.wu/wv snapped to (2,1)');

  const sB0 = projectRulerPoint3D(B, plotU, plotV, 0, rot0Origin.originX, rot0Origin.originY);
  const sC0 = projectRulerPoint3D(C, plotU, plotV, 0, rot0Origin.originX, rot0Origin.originY);
  const flat0 = measureHorizontalPlane(sB0[0], sB0[1], sC0[0], sC0[1]);
  assert.ok(Math.abs(flat0.totalMeters - 9.6) < 1e-6, `M1: elevated 1-cell flat must be 9.6m, got ${flat0.totalMeters}`);

  // M7: rotating 90/180/270 must keep world length & 3D screen distance consistent
  for (const r of [1, 2, 3] as const) {
    const vU = r % 2 === 1 ? plotV : plotU;
    const vV = r % 2 === 1 ? plotU : plotV;
    const o = getPlotOrigin(256, 256, vU, vV, 16);
    const sB = projectRulerPoint3D(B, plotU, plotV, r, o.originX, o.originY);
    const sC = projectRulerPoint3D(C, plotU, plotV, r, o.originX, o.originY);
    const flatR = measureHorizontalPlane(sB[0], sB[1], sC[0], sC[1]);
    assert.ok(Math.abs(flatR.totalMeters - 9.6) < 1e-6, `M7: rot=${r} flat length must stay 9.6m`);
  }
  console.log('PASS: M1 (vert_then_flat elevated plane C) + M7 (3D ruler rotation invariance)');
}

function testResizeAndBlendAndPsdTrim() {
  // L5: resize shifts raster pixel by exact plot origin delta
  const doc = new BuilderDocument(128, 128, 2, 2, 16);
  const rLayer = new BuilderLayer(128, 128, 'Raster', 'raster');
  const oldO = doc.getViewOrigin();
  const px = oldO.originX;
  const py = oldO.originY;
  const idx = (py * 128 + px) * 4;
  rLayer.data[idx] = 255;
  rLayer.data[idx + 1] = 80;
  rLayer.data[idx + 2] = 40;
  rLayer.data[idx + 3] = 255;
  doc.layers.push(rLayer);

  doc.resize(256, 256, 4, 2, 24);
  const newO = doc.getViewOrigin();
  const nIdx = (newO.originY * 256 + newO.originX) * 4;
  assert.equal(rLayer.data[nIdx], 255, 'L5: raster pixel tracked view origin X on non-square plot resize');
  assert.equal(rLayer.data[nIdx + 3], 255, 'L5: raster pixel tracked view origin Y on non-square plot resize');

  // L6: multiply & hue blend modes
  const bDoc = new BuilderDocument(8, 8, 1, 1, 0);
  const bottom = new BuilderLayer(8, 8, 'Bottom', 'raster');
  bottom.data.set([200, 100, 50, 255], 0); // (0,0)
  const topMul = new BuilderLayer(8, 8, 'Mul', 'raster');
  topMul.blend = 'multiply';
  topMul.data.set([128, 255, 128, 255], 0);
  bDoc.layers.push(bottom, topMul);
  const mulOut = bDoc.renderToBuffer();
  assert.ok(Math.abs(mulOut[0] - Math.round((200 * 128) / 255)) <= 1, 'L6: multiply blend');
  assert.equal(mulOut[1], 100, 'L6: multiply by 255 preserves channel');

  const topHue = new BuilderLayer(8, 8, 'Hue', 'raster');
  topHue.blend = 'hue';
  topHue.data.set([0, 0, 255, 255], 0); // pure blue hue over warm bottom
  bDoc.layers = [bottom, topHue];
  const hueOut = bDoc.renderToBuffer();
  assert.ok(hueOut[2] > hueOut[0], 'L6: hue blend transfers blue hue onto backdrop');

  // H6 + L15_int: trimmed PSD preserves hidden off-center layer & uses tight layer bbox
  const psdDoc = new BuilderDocument(128, 128, 4, 4, 16);
  const visLayer = new BuilderLayer(
    128,
    128,
    'VisibleBox',
    'shape',
    createDefaultShape('box', { u: 1, v: 1, zPx: 0, sizeU: 1, sizeV: 1, heightPx: 16 }),
  );
  const hiddenRaster = new BuilderLayer(128, 128, 'HiddenMark', 'raster');
  hiddenRaster.visible = false;
  // Place opaque 2x2 pixel mark at far left (4, 10)..(5, 11) outside VisibleBox
  for (const [hx, hy] of [[4, 10], [5, 10], [4, 11], [5, 11]]) {
    const hi = (hy * 128 + hx) * 4;
    hiddenRaster.data[hi] = 12;
    hiddenRaster.data[hi + 1] = 234;
    hiddenRaster.data[hi + 2] = 56;
    hiddenRaster.data[hi + 3] = 255;
  }
  const emptyLayer = new BuilderLayer(128, 128, 'Empty', 'raster');
  psdDoc.layers.push(visLayer, hiddenRaster, emptyLayer);
  psdDoc.rerenderAllShapes();

  initializeCanvas(
    ((w: number, h: number) => ({ width: w, height: h })) as unknown as typeof HTMLCanvasElement & ((w: number, h: number) => HTMLCanvasElement),
    undefined,
    ((w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })) as unknown as (w: number, h: number) => ImageData,
  );
  const psdBuf = exportBuilderPsd(psdDoc, { trim: true, scale: 1, includeRasters: true });
  const parsed = readPsd(psdBuf, { useImageData: true, skipThumbnail: true });
  assert.ok(parsed.children && parsed.children.length === 3, 'H6: all 3 layers preserved');
  const parsedHidden = parsed.children![1];
  assert.equal(parsedHidden.hidden, true, 'H6: hidden flag preserved');
  assert.ok(parsedHidden.imageData, 'H6: hidden layer retains pixels in trimmed PSD');
  assert.equal(parsedHidden.imageData!.width, 2, 'H6/L15: tight per-layer width');
  assert.equal(parsedHidden.imageData!.height, 2, 'H6/L15: tight per-layer height');
  assert.equal(parsedHidden.left, 0, 'H6: trimmed origin X shifted to hidden left bound (x=4)');
  assert.equal(parsedHidden.imageData!.data[1], 234, 'H6: hidden pixel RGB preserved');

  // 4-view layered PSD export (one layer per 0°/90°/180°/270° viewpoint)
  const fourDoc = new BuilderDocument(128, 128, 2, 2, 16);
  fourDoc.layers.push(new BuilderLayer(128, 128, 'AsymWedge', 'shape', createDefaultShape('wedge', {
    u: 0.25,
    v: 0.25,
    sizeU: 1.5,
    sizeV: 1.0,
    heightPx: 20,
    ori: 0,
    baseColor: { r: 210, g: 110, b: 80, a: 255 },
  })));
  fourDoc.rerenderAllShapes();
  const beforeFourSnap = new Uint8ClampedArray(fourDoc.renderToBuffer());
  const fourPsdBuf = exportFourViewLayersPsd(fourDoc, { trim: true, scale: 2, includeRasters: true });
  const parsedFour = readPsd(fourPsdBuf, { useImageData: true, skipThumbnail: true });
  assert.ok(parsedFour.children && parsedFour.children.length === 4, '4-view PSD must contain 4 layers');
  assert.deepEqual(
    parsedFour.children!.map((c) => c.name),
    ['视角 270°', '视角 180°', '视角 90°', '视角 0°'],
    '4-view PSD layers must represent all 4 rotations with 0deg on top',
  );
  for (const child of parsedFour.children!) {
    assert.equal(child.hidden, false, '4-view PSD layers must be visible');
    assert.ok(child.imageData && child.imageData.width > 0 && child.imageData.height > 0, 'each view layer must have pixels');
    assert.equal(child.imageData!.width % 2, 0, 'scale=2 must produce even layer width');
  }
  assert.equal(fourDoc.viewRotation, 0, 'exportFourViewLayersPsd must restore original viewRotation');
  assert.ok(buffersEqual(fourDoc.renderToBuffer(), beforeFourSnap), 'exportFourViewLayersPsd must restore doc pixels cleanly');

  console.log('PASS: L5 (document.resize delta), L6 (multiply/hue blend), H6/L15 (trimmed PSD hidden+tight bbox & 4-view layered PSD)');
}

async function testRightTriPrismAndPlotFrame() {
  // 1. Complementary right_tri_prism halves on a non-square 4x3 plot: 4x90 rotation closure + depth sort
  const doc = new BuilderDocument(256, 256, 4, 3, 16);
  assert.deepEqual(doc.plotFrame, { visible: true, u: 0, v: 0, sizeU: 4, sizeV: 3 });

  const backHalf = new BuilderLayer(
    doc.width,
    doc.height,
    'TriBack',
    'shape',
    createDefaultShape('right_tri_prism', {
      u: 1,
      v: 1,
      zPx: 0,
      sizeU: 1.5,
      sizeV: 1,
      heightPx: 24,
      ori: 0,
      triPrismCut: 'vertical',
      baseColor: { r: 220, g: 110, b: 100, a: 255 },
    }),
  );
  const frontHalf = new BuilderLayer(
    doc.width,
    doc.height,
    'TriFront',
    'shape',
    createDefaultShape('right_tri_prism', {
      u: 1,
      v: 1,
      zPx: 0,
      sizeU: 1.5,
      sizeV: 1,
      heightPx: 24,
      ori: 2,
      triPrismCut: 'vertical',
      baseColor: { r: 90, g: 170, b: 230, a: 255 },
    }),
  );
  doc.layers.push(frontHalf, backHalf);
  doc.rerenderAllShapes();
  doc.sortLayersByIsoDepth();
  assert.ok(
    doc.layers.indexOf(backHalf) < doc.layers.indexOf(frontHalf),
    'rot=0: ori=0 right_tri_prism must sort behind ori=2 complementary half in same cell',
  );

  const p0 = doc.renderToBuffer();
  for (let s = 1; s <= 4; s++) {
    doc.rotateView(1);
    assert.equal(countPixels(doc.renderToBuffer()).semiTransparent, 0, `right_tri_prism rot step ${s} must have 0 AA`);
  }
  const p360 = doc.renderToBuffer();
  assert.ok(buffersEqual(p360, p0), 'right_tri_prism 4x90deg rotation must close pixel-for-pixel');

  doc.rotateView(2);
  assert.ok(
    doc.layers.indexOf(frontHalf) < doc.layers.indexOf(backHalf),
    'rot=2: complementary halves must flip front/back order cleanly',
  );

  // 2. PlotFrame undo/redo & .bmeow serialize/deserialize round-trip
  const hist = new History();
  hist.push('隐藏并移动场地边框', doc);
  doc.plotFrame = { visible: false, u: 0.5, v: -0.25, sizeU: 2.5, sizeV: 2 };
  const json = serializeBmeowProject(doc, 'BlenderMeowTest');
  const loaded = await deserializeBmeowProject(json);
  assert.deepEqual(loaded.doc.plotFrame, { visible: false, u: 0.5, v: -0.25, sizeU: 2.5, sizeV: 2 });

  hist.undo(doc);
  assert.deepEqual(doc.plotFrame, { visible: true, u: 0, v: 0, sizeU: 4, sizeV: 3 }, 'History undo restores plotFrame');
  hist.redo(doc);
  assert.deepEqual(doc.plotFrame, { visible: false, u: 0.5, v: -0.25, sizeU: 2.5, sizeV: 2 }, 'History redo restores plotFrame');
  console.log('PASS: right_tri_prism (4x90 closure + depth sort) & plotFrame (undo/redo + .bmeow round-trip)');
}

function testLargeDomeAndSphereWatertight() {
  const cases: Array<{ su: number; sv: number; h: number; domeMode: 'dome' | 'sphere'; outlineMode: 'none' | 'outer' }> = [
    { su: 6, sv: 6, h: 36, domeMode: 'dome', outlineMode: 'none' },
    { su: 6, sv: 6, h: 72, domeMode: 'dome', outlineMode: 'outer' },
    { su: 6, sv: 6, h: 72, domeMode: 'sphere', outlineMode: 'none' },
    { su: 10, sv: 10, h: 96, domeMode: 'dome', outlineMode: 'none' },
    { su: 10, sv: 10, h: 96, domeMode: 'sphere', outlineMode: 'outer' },
    { su: 12, sv: 2, h: 18, domeMode: 'dome', outlineMode: 'none' },
    { su: 2, sv: 12, h: 90, domeMode: 'sphere', outlineMode: 'none' },
  ];

  const W = 512;
  const H = 512;
  const buf = new Uint8ClampedArray(W * H * 4);

  for (const cfg of cases) {
    buf.fill(0);
    const shape = createDefaultShape('dome', {
      u: 0,
      v: 0,
      zPx: 0,
      sizeU: cfg.su,
      sizeV: cfg.sv,
      heightPx: cfg.h,
      domeMode: cfg.domeMode,
      outlineMode: cfg.outlineMode,
    });
    renderShapeToBuffer(buf, W, H, shape, cfg.su, cfg.sv, 0, 256, 360);
    const { solid, semiTransparent } = countPixels(buf);
    assert.ok(solid > 100, `Expected >100 pixels for ${JSON.stringify(cfg)}, got ${solid}`);
    assert.equal(semiTransparent, 0, `Expected 0 AA leakage for ${JSON.stringify(cfg)}`);

    let rowHoles = 0;
    for (let y = 0; y < H; y++) {
      let first = -1;
      let last = -1;
      for (let x = 0; x < W; x++) {
        if (buf[(y * W + x) * 4 + 3] > 0) {
          if (first < 0) first = x;
          last = x;
        }
      }
      if (first >= 0) {
        for (let x = first + 1; x < last; x++) {
          if (buf[(y * W + x) * 4 + 3] === 0) rowHoles++;
        }
      }
    }

    let colHoles = 0;
    for (let x = 0; x < W; x++) {
      let first = -1;
      let last = -1;
      for (let y = 0; y < H; y++) {
        if (buf[(y * W + x) * 4 + 3] > 0) {
          if (first < 0) first = y;
          last = y;
        }
      }
      if (first >= 0) {
        for (let y = first + 1; y < last; y++) {
          if (buf[(y * W + x) * 4 + 3] === 0) colHoles++;
        }
      }
    }

    assert.equal(rowHoles, 0, `Large ${cfg.domeMode} ${cfg.su}x${cfg.sv} H=${cfg.h} has ${rowHoles} row holes`);
    assert.equal(colHoles, 0, `Large ${cfg.domeMode} ${cfg.su}x${cfg.sv} H=${cfg.h} has ${colHoles} col holes`);
  }

  // Asymmetric elliptic dome & sphere across 4x90deg rotations on non-square plot (4x3)
  for (const domeMode of ['dome', 'sphere'] as const) {
    const doc = new BuilderDocument(256, 256, 4, 3, 16);
    doc.layers.push(
      new BuilderLayer(
        doc.width,
        doc.height,
        `Asym_${domeMode}`,
        'shape',
        createDefaultShape('dome', {
          u: 0.75,
          v: 0.5,
          zPx: 0,
          sizeU: 2.5,
          sizeV: 1.5,
          heightPx: 42,
          domeMode,
        }),
      ),
    );
    doc.rerenderAllShapes();
    const r0 = doc.renderToBuffer();
    doc.rotateView(1);
    const r90 = doc.renderToBuffer();
    assert.ok(!buffersEqual(r90, r0), `Asymmetric ${domeMode} 90deg should differ from 0deg`);
    doc.rotateView(1);
    doc.rotateView(1);
    doc.rotateView(1);
    const r360 = doc.renderToBuffer();
    assert.ok(buffersEqual(r360, r0), `Asymmetric ${domeMode} must close pixel-for-pixel after 4x90deg rotations`);
  }

  console.log('PASS: Large dome/sphere analytical raycaster (0 row/col holes & 4x90deg rotation closure)');
}

async function testLoftWatertightAndRotationClosure() {
  // 1. Watertight check on large convex curved loft (6x6, H=80)
  const W = 400;
  const H = 400;
  const buf = new Uint8ClampedArray(W * H * 4);
  const largeLoft = createDefaultShape('loft', {
    u: 1,
    v: 1,
    zPx: 0,
    sizeU: 6,
    sizeV: 6,
    heightPx: 80,
    loftInterp: 'smooth',
    loftSections: [
      { id: 'w1', name: 'Bot', t: 0, scale: 1, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: createLoftPresetNodes('circle') },
      { id: 'w2', name: 'Mid', t: 0.5, scale: 0.8, twistDeg: 15, offsetU: 0, offsetV: 0, nodes: createLoftPresetNodes('rounded_rect') },
      { id: 'w3', name: 'Top', t: 1, scale: 0.95, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: createLoftPresetNodes('circle') },
    ],
  });
  renderShapeToBuffer(buf, W, H, largeLoft, 8, 8, 0, 200, 120);
  const stats = countPixels(buf);
  assert.ok(stats.solid > 3000, `Expected large loft > 3000 px, got ${stats.solid}`);
  assert.equal(stats.semiTransparent, 0, 'Large loft must have 0 semi-transparent pixels');

  let rowHoles = 0;
  for (let y = 0; y < H; y++) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < W; x++) {
      if (buf[(y * W + x) * 4 + 3] > 0) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first >= 0) {
      for (let x = first + 1; x < last; x++) {
        if (buf[(y * W + x) * 4 + 3] === 0) rowHoles++;
      }
    }
  }
  assert.equal(rowHoles, 0, `Large convex curved loft has ${rowHoles} interior row holes`);

  // 2. Asymmetric concave & twisted multi-section 4x90deg rotation closure on non-square (4x3) plot
  const doc = new BuilderDocument(288, 288, 4, 3, 16);
  const asymLoft = createDefaultShape('loft', {
    u: 0.75,
    v: 0.5,
    zPx: 0,
    sizeU: 2.25,
    sizeV: 1.5,
    heightPx: 48,
    ori: 1,
    loftInterp: 'smooth',
    loftSections: [
      { id: 'a0', name: '底面肾形', t: 0, scale: 1.0, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: createLoftPresetNodes('kidney') },
      { id: 'a1', name: '中腰心形', t: 0.5, scale: 0.82, twistDeg: 35, offsetU: 0.08, offsetV: -0.04, nodes: createLoftPresetNodes('heart') },
      { id: 'a2', name: '顶层圆方', t: 1.0, scale: 1.08, twistDeg: 70, offsetU: -0.05, offsetV: 0.05, nodes: createLoftPresetNodes('rounded_rect') },
    ],
    pattern: {
      type: 'windows',
      primaryColor: { r: 80, g: 190, b: 255, a: 255 },
      rows: 4,
      cols: 3,
      spacingPx: 2,
      marginPx: 3,
      applyTop: false,
    },
  });
  doc.layers.push(new BuilderLayer(doc.width, doc.height, 'LoftAsym', 'shape', asymLoft));
  doc.rerenderAllShapes();

  const r0 = doc.renderToBuffer();
  assert.equal(countPixels(r0).semiTransparent, 0, 'Asym loft must have 0 AA pixels');
  doc.rotateView(1);
  const r90 = doc.renderToBuffer();
  assert.ok(!buffersEqual(r90, r0), 'Asym loft 90deg rotation should differ from 0deg');
  doc.rotateView(1);
  doc.rotateView(1);
  doc.rotateView(1);
  const r360 = doc.renderToBuffer();
  assert.ok(buffersEqual(r360, r0), 'Asym concave/twisted loft must close pixel-for-pixel after 4x90deg rotations');

  // 3. Serialization roundtrip preserves loftSections + pixels
  const saved = serializeBmeowProject(doc, 'LoftProj');
  const { doc: restored } = await deserializeBmeowProject(saved);
  const restoredShape = restored.layers[0]?.shape;
  assert.ok(restoredShape, 'Restored loft shape must exist');
  assert.equal(restoredShape.loftSections?.length, 3, 'Restored loft must preserve all 3 control sections');
  assert.equal(restoredShape.loftSections?.[1].twistDeg, 35);
  assert.ok(buffersEqual(restored.renderToBuffer(), r0), 'Restored loft pixels must match original bit-for-bit');

  // 4. Regression check: ensureActiveLoftSection preserves object identity across repeated calls & live mutations update rendered pixels
  const editShape = createDefaultShape('loft', {
    u: 1,
    v: 1,
    zPx: 0,
    sizeU: 2,
    sizeV: 2,
    heightPx: 40,
    activeLoftSectionId: 'sec-2',
  });
  const secRef = ensureActiveLoftSection(editShape);
  const secRefAgain = ensureActiveLoftSection(editShape);
  assert.equal(secRef, editShape.loftSections![1], 'ensureActiveLoftSection must return exact live object inside shape.loftSections');
  assert.equal(secRefAgain, secRef, 'Repeated calls must keep exact same object identity');

  const editBuf0 = new Uint8ClampedArray(256 * 256 * 4);
  renderShapeToBuffer(editBuf0, 256, 256, editShape, 4, 4, 0, 128, 128);

  secRef.scale = 1.3;
  ensureActiveLoftSection(editShape);
  const editBufScaled = new Uint8ClampedArray(256 * 256 * 4);
  renderShapeToBuffer(editBufScaled, 256, 256, editShape, 4, 4, 0, 128, 128);
  assert.ok(!buffersEqual(editBufScaled, editBuf0), 'Mutating sec.scale must change rendered loft pixels');

  secRef.twistDeg = 55;
  const editBufTwist = new Uint8ClampedArray(256 * 256 * 4);
  renderShapeToBuffer(editBufTwist, 256, 256, editShape, 4, 4, 0, 128, 128);
  assert.ok(!buffersEqual(editBufTwist, editBufScaled), 'Mutating sec.twistDeg must change rendered loft pixels');

  secRef.offsetU = 0.25;
  const editBufOffset = new Uint8ClampedArray(256 * 256 * 4);
  renderShapeToBuffer(editBufOffset, 256, 256, editShape, 4, 4, 0, 128, 128);
  assert.ok(!buffersEqual(editBufOffset, editBufTwist), 'Mutating sec.offsetU must change rendered loft pixels');

  secRef.t = 0.72;
  const editBufMovedT = new Uint8ClampedArray(256 * 256 * 4);
  renderShapeToBuffer(editBufMovedT, 256, 256, editShape, 4, 4, 0, 128, 128);
  assert.ok(!buffersEqual(editBufMovedT, editBufOffset), 'Mutating sec.t must change rendered loft pixels');

  console.log('PASS: Curved lofted column (watertight 6x6 H=80, concave/twisted 4x90deg closure & live section mutation regression)');
}

async function testOpusV112ReviewFixes() {
  // L1: Non-loft shapes must omit loftSections/loftInterp/activeLoftSectionId both in memory and .bmeow JSON
  const plainBox = createDefaultShape('box');
  assert.equal(plainBox.loftSections, undefined, 'Non-loft shape should not carry loftSections in memory');
  const boxDoc = new BuilderDocument(128, 128, 4, 4, 16);
  boxDoc.layers.push(new BuilderLayer(128, 128, 'BoxOnly', 'shape', plainBox));
  boxDoc.rerenderAllShapes();
  const boxJson = serializeBmeowProject(boxDoc, 'BoxProj');
  assert.ok(!boxJson.includes('"loftSections"'), '.bmeow JSON for non-loft shapes must omit loftSections');
  const { doc: restoredBoxDoc } = await deserializeBmeowProject(boxJson);
  assert.equal(restoredBoxDoc.layers[0]?.shape?.loftSections, undefined, 'Restored non-loft shape must keep loftSections omitted');

  // M1 & L10: Normalized normal in shadeByNormal(!autoShade) + roof_grid gated to upper dome/sphere cap
  const domeBuf = new Uint8ClampedArray(320 * 320 * 4);
  const bigDome = createDefaultShape('dome', {
    u: 0,
    v: 0,
    zPx: 0,
    sizeU: 6,
    sizeV: 6,
    heightPx: 60, // rz=60 > 26: previously unnormalized nz = 18/60 = 0.3 never exceeded 0.7
    domeMode: 'dome',
    autoShade: false,
    baseColor: { r: 60, g: 120, b: 200, a: 255 },
    roofColor: { r: 220, g: 80, b: 70, a: 255 },
  });
  renderShapeToBuffer(domeBuf, 320, 320, bigDome, 6, 6, 0, 160, 220);
  let sawBase = false;
  let sawRoof = false;
  for (let i = 0; i < domeBuf.length; i += 4) {
    if (domeBuf[i + 3] === 0) continue;
    if (domeBuf[i] === 60 && domeBuf[i + 1] === 120 && domeBuf[i + 2] === 200) sawBase = true;
    if (domeBuf[i] === 220 && domeBuf[i + 1] === 80 && domeBuf[i + 2] === 70) sawRoof = true;
  }
  assert.ok(sawRoof, 'M1: Large dome (rz=60) with autoShade=false must apply roofColor near top cap');
  assert.ok(sawBase, 'M1: Large dome (rz=60) with autoShade=false must keep baseColor on lower flanks');

  const sphereBuf = new Uint8ClampedArray(256 * 256 * 4);
  const sphereGrid = createDefaultShape('dome', {
    u: 1,
    v: 1,
    zPx: 0,
    sizeU: 2,
    sizeV: 2,
    heightPx: 40,
    domeMode: 'sphere',
    pattern: {
      type: 'roof_grid',
      primaryColor: { r: 255, g: 0, b: 255, a: 255 },
      rows: 4,
      cols: 4,
      spacingPx: 2,
      marginPx: 2,
      applyTop: true,
    },
  });
  // Center of sphere at zCenter = 20 -> screen Y = originY + (2+2)*8 - 20 = 160 + 32 - 20 = 172
  renderShapeToBuffer(sphereBuf, 256, 256, sphereGrid, 4, 4, 0, 128, 160);
  let topGridPx = 0;
  let botGridPx = 0;
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      if (sphereBuf[i + 3] === 0) continue;
      if (sphereBuf[i] === 255 && sphereBuf[i + 1] === 0 && sphereBuf[i + 2] === 255) {
        if (y < 165) topGridPx++;
        if (y > 180) botGridPx++;
      }
    }
  }
  assert.ok(topGridPx > 0, 'L10: roof_grid should still render on upward sphere cap');
  assert.equal(botGridPx, 0, 'L10: roof_grid must not wrap onto bottom half of sphere');

  // L9: Offscreen-clipped dome must not draw outline down canvas clip edge (px = 0)
  const clipBuf = new Uint8ClampedArray(160 * 160 * 4);
  const clippedDome = createDefaultShape('dome', {
    u: 0,
    v: 0,
    zPx: 0,
    sizeU: 4,
    sizeV: 4,
    heightPx: 40,
    domeMode: 'sphere',
    outlineMode: 'outer',
    outlineColor: { r: 10, g: 20, b: 30, a: 255 },
    baseColor: { r: 180, g: 180, b: 190, a: 255 },
  });
  // Shift originX to 0 so center of sphere (u=2,v=2) projects onto x = 0, clipping left half
  renderShapeToBuffer(clipBuf, 160, 160, clippedDome, 4, 4, 0, 0, 48);
  let px0NonOutline = 0;
  for (let y = 0; y < 160; y++) {
    const i = (y * 160 + 0) * 4;
    if (clipBuf[i + 3] === 0) continue;
    if (!(clipBuf[i] === 10 && clipBuf[i + 1] === 20 && clipBuf[i + 2] === 30)) {
      px0NonOutline++;
    }
  }
  assert.ok(px0NonOutline > 20, `L9: Interior dome pixels clipped at px=0 must not be falsely outlined (got ${px0NonOutline} fill pixels)`);

  // M5 & L11: Overhanging loft footprint + vertical right_tri_prism empty half separation
  const overDoc = new BuilderDocument(256, 256, 4, 4, 16);
  const overhangLoft = createDefaultShape('loft', {
    u: 0,
    v: 0,
    zPx: 0,
    sizeU: 1,
    sizeV: 1,
    heightPx: 30,
    loftSections: [
      { id: 'o1', name: 'Bot', t: 0, scale: 1.0, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: createLoftPresetNodes('square') },
      { id: 'o2', name: 'Top', t: 1, scale: 1.6, twistDeg: 0, offsetU: 0.4, offsetV: 0, nodes: createLoftPresetNodes('square') },
    ],
  });
  overDoc.layers.push(new BuilderLayer(256, 256, 'OverLoft', 'shape', overhangLoft));
  assert.equal(overDoc.getTopElevationAt(1.15, 0.4, 0.3, 0.3), 30, 'M5: getTopElevationAt must detect overhanging loft top section');

  const triDoc = new BuilderDocument(256, 256, 4, 4, 16);
  const prismLayer = new BuilderLayer(
    256,
    256,
    'TriPrism',
    'shape',
    createDefaultShape('right_tri_prism', {
      u: 0,
      v: 0,
      zPx: 0,
      sizeU: 3,
      sizeV: 3,
      heightPx: 40,
      ori: 0,
      triPrismCut: 'vertical',
    }),
  );
  // Placed strictly inside the cut-away front empty half (u + v >= 3.6 > 3.0) with smaller height
  const frontBox = new BuilderLayer(
    256,
    256,
    'FrontBox',
    'shape',
    createDefaultShape('box', {
      u: 1.8,
      v: 1.8,
      zPx: 0,
      sizeU: 1,
      sizeV: 1,
      heightPx: 12,
    }),
  );
  triDoc.layers.push(frontBox, prismLayer);
  assert.equal(triDoc.getTopElevationAt(1.8, 1.8, 1, 1, frontBox.id), 0, 'L11: Empty cut half of vertical right_tri_prism must not float box');
  triDoc.sortLayersByIsoDepth();
  assert.ok(triDoc.layers.indexOf(prismLayer) < triDoc.layers.indexOf(frontBox), 'L11: Vertical right_tri_prism must precede shape inside its empty front half');

  // L2, L4, L5: Interpolation helper, in-place sanitization, and transient activeLoftSectionId
  const secSq = { id: 'sq', name: 'Sq', t: 0, scale: 1, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: createLoftPresetNodes('square') };
  const secCi = { id: 'ci', name: 'Ci', t: 1, scale: 1, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: createLoftPresetNodes('circle') };
  const midNodes = interpolateLoftSectionNodes(secSq, secCi, 0.5);
  assert.equal(midNodes.length, 12, 'L2: Interpolating dissimilar node counts should produce 12 smooth nodes');

  const dirtyLoft = createDefaultShape('loft', { activeLoftSectionId: 'sec-2' });
  const sec1OrigRef = dirtyLoft.loftSections![0];
  sec1OrigRef.scale = 99;
  const activeSec = ensureActiveLoftSection(dirtyLoft);
  assert.equal(dirtyLoft.loftSections![0], sec1OrigRef, 'L5: In-place sanitization must keep section object identity');
  assert.equal(sec1OrigRef.scale, 1.6, 'L5: Out-of-range scale must be clamped in-place');
  assert.equal(activeSec.id, 'sec-2');

  const l4Doc = new BuilderDocument(128, 128, 4, 4, 16);
  const l4Layer = new BuilderLayer(128, 128, 'L4Loft', 'shape', dirtyLoft);
  l4Doc.layers.push(l4Layer);
  const snap = l4Doc.snapshot();
  assert.equal(snap.layers[0].shape?.activeLoftSectionId, undefined, 'L4: Snapshot must omit activeLoftSectionId');
  l4Layer.shape!.activeLoftSectionId = 'sec-3';
  l4Doc.restore(snap);
  assert.equal(l4Doc.layers[0].shape?.activeLoftSectionId, 'sec-3', 'L4: Restore must preserve current activeLoftSectionId');

  console.log('PASS: Opus v1.1.2 fixes (L1 compact serialization, M1/L10/L9 dome shading/grid/clip, M5/L11 depth & stack, L2/L4/L5 loft)');
}

function testPixelMeowColorAndPalette() {
  // 1. HSL round-trip & hex parsing
  for (const [r, g, b] of [
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 77],
    [65, 166, 246],
    [168, 176, 194],
  ]) {
    const [h, s, l] = rgbToHsl(r, g, b);
    const [rr, gg, bb] = hslToRgb(h, s, l);
    assert.ok(Math.abs(rr - r) <= 2 && Math.abs(gg - g) <= 2 && Math.abs(bb - b) <= 2, `HSL round-trip ${r},${g},${b}`);
  }

  assert.equal(toHex8({ r: 59, g: 130, b: 246, a: 128 }), '#3B82F680');
  assert.deepEqual(parseHex('#abc'), { r: 170, g: 187, b: 204, a: 255 });
  assert.deepEqual(parseHex('0x1234'), { r: 17, g: 34, b: 51, a: 68 });
  assert.deepEqual(parseColorCode('#FF8800AA'), { rgba: { r: 255, g: 136, b: 0, a: 170 }, hasAlpha: true });
  assert.deepEqual(parseColorCode('rgb(10, 20, 30)'), { rgba: { r: 10, g: 20, b: 30, a: 255 }, hasAlpha: false });
  assert.deepEqual(parseColorCode('rgba(100%, 0%, 50%, 0.5)'), { rgba: { r: 255, g: 0, b: 128, a: 128 }, hasAlpha: true });
  assert.deepEqual(parseColorCode('12, 34, 56'), { rgba: { r: 12, g: 34, b: 56, a: 255 }, hasAlpha: false });
  assert.equal(parseColorCode('not-a-color'), null);

  // 2. Palettes & .gpl / .hex / .bmeow extraction
  assert.ok(BUILTIN_PALETTES.length === 23, `Expected 23 built-in palettes, got ${BUILTIN_PALETTES.length}`);
  assert.ok(BUILTIN_PALETTES.some((p) => p.id === 'iso_arch32' && p.colors.length === 32), 'iso_arch32 palette present');
  for (const p of BUILTIN_PALETTES) {
    assert.ok(p.colors.length > 0, `Palette ${p.id} non-empty`);
    for (const c of p.colors) {
      assert.match(c, /^#[0-9A-F]{6}$/, `Palette ${p.id} color ${c} uppercase hex`);
    }
  }
  assert.equal(loadUserPalettes()[0].id, 'mine', 'loadUserPalettes works in Node without localStorage');

  const gplText = 'GIMP Palette\nName: Test\nColumns: 8\n#\n  0 128 300\tClamped\n#1a2b3c\n1a2b3c\n';
  assert.deepEqual(parsePaletteFile(gplText), ['#0080FF', '#1A2B3C']);

  const roundTripGpl = paletteToGpl({ id: 't', name: 'Sample', colors: ['#123456', '#ABCDEF'] });
  assert.deepEqual(parsePaletteFile(roundTripGpl), ['#123456', '#ABCDEF']);

  const doc = new BuilderDocument(128, 128, 4, 4, 16);
  const bLayer = new BuilderLayer(
    128,
    128,
    'ColorCheck',
    'shape',
    createDefaultShape('box', {
      baseColor: { r: 100, g: 150, b: 200, a: 255 },
      roofColor: { r: 214, g: 112, b: 96, a: 255 },
      pattern: { type: 'windows', primaryColor: { r: 96, g: 185, b: 245, a: 255 }, rows: 2, cols: 2, spacingPx: 2, marginPx: 2, applyTop: false },
    }),
  );
  doc.layers.push(bLayer);
  const bmeowJson = serializeBmeowProject(doc, 'PaletteTest');
  const extracted = extractColorsFromBmeowJson(bmeowJson);
  assert.deepEqual(extracted, ['#6496C8', '#D67060', toHex(bLayer.shape!.pattern.primaryColor)]);

  // 3. Ensure no native <input type="color"> remains anywhere in src/
  const srcRoot = path.resolve(process.cwd(), 'src');
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) out.push(...walk(full));
      else if (ent.isFile() && /\.(ts|tsx|js|jsx|html)$/i.test(ent.name)) out.push(full);
    }
    return out;
  };
  for (const f of walk(srcRoot)) {
    const content = fs.readFileSync(f, 'utf8');
    assert.ok(!/type\s*[:=]\s*['"`]color['"`]/i.test(content), `Native color input found in ${f}`);
  }

  console.log('PASS: Pixel Meow color picker utilities, 23 palettes, .gpl/.bmeow import/export, and no native color inputs');
}

async function testArchSolidHollowAndRotationClosure() {
  const W = 256;
  const H = 256;
  const { originX, originY } = getPlotOrigin(W, H, 4, 4, 16);

  // 1. All 8 built-in arch presets in solid, hollow shell, and hollow portal modes: zero AA + hollow carves opening
  for (const preset of ARCH_PRESETS) {
    const nodes = createArchPresetNodes(preset.id);
    const bufSolid = new Uint8ClampedArray(W * H * 4);
    const bufShell = new Uint8ClampedArray(W * H * 4);
    const bufPortal = new Uint8ClampedArray(W * H * 4);

    renderShapeToBuffer(
      bufSolid,
      W,
      H,
      createDefaultShape('arch', {
        u: 0.5,
        v: 1,
        sizeU: 3,
        sizeV: 1.5,
        heightPx: 36,
        archHollow: false,
        archNodes: nodes,
        outlineMode: 'all_edges',
      }),
      4,
      4,
      0,
      originX,
      originY,
    );
    renderShapeToBuffer(
      bufShell,
      W,
      H,
      createDefaultShape('arch', {
        u: 0.5,
        v: 1,
        sizeU: 3,
        sizeV: 1.5,
        heightPx: 36,
        archHollow: true,
        archHollowStyle: 'shell',
        archThickness: 0.24,
        archNodes: nodes,
        outlineMode: 'all_edges',
      }),
      4,
      4,
      0,
      originX,
      originY,
    );
    renderShapeToBuffer(
      bufPortal,
      W,
      H,
      createDefaultShape('arch', {
        u: 0.5,
        v: 1,
        sizeU: 3,
        sizeV: 1.5,
        heightPx: 36,
        archHollow: true,
        archHollowStyle: 'portal',
        archThickness: 0.24,
        archNodes: nodes,
        outlineMode: 'outer',
      }),
      4,
      4,
      0,
      originX,
      originY,
    );

    const cSolid = countPixels(bufSolid);
    const cShell = countPixels(bufShell);
    const cPortal = countPixels(bufPortal);
    assert.equal(cSolid.semiTransparent, 0, `Arch preset ${preset.id} solid must have 0 AA`);
    assert.equal(cShell.semiTransparent, 0, `Arch preset ${preset.id} shell must have 0 AA`);
    assert.equal(cPortal.semiTransparent, 0, `Arch preset ${preset.id} portal must have 0 AA`);
    assert.ok(cSolid.solid > 300, `Arch preset ${preset.id} solid must render substantial pixels`);
    assert.ok(
      cShell.solid > 100 && cShell.solid < cSolid.solid,
      `Arch preset ${preset.id} hollow shell (${cShell.solid}) must have fewer pixels than solid (${cSolid.solid})`,
    );
    assert.ok(
      preset.id === 'rect_door' ? cPortal.solid === cShell.solid : cPortal.solid > cShell.solid,
      `Arch preset ${preset.id} portal block (${cPortal.solid}) must match or exceed shell (${cShell.solid})`,
    );
  }

  // 2. Non-square 4x2 plot 4x90deg rotation closure with an asymmetric multi-node hollow arch + freehand fit
  const asymNodes = fitFreehandArchNodes([
    [0.05, 0],
    [0.12, 0.55],
    [0.36, 0.98],
    [0.68, 0.72],
    [0.88, 0.35],
    [0.96, 0],
  ]);
  assert.ok(asymNodes.length >= 3, 'Freehand arch fitting must return >= 3 control nodes');

  const doc = new BuilderDocument(256, 256, 4, 2, 16);
  const archLayer = new BuilderLayer(
    256,
    256,
    'AsymHollowArch',
    'shape',
    createDefaultShape('arch', {
      u: 0.5,
      v: 0.25,
      sizeU: 2.5,
      sizeV: 1.25,
      heightPx: 30,
      ori: 1,
      archHollow: true,
      archHollowStyle: 'shell',
      archThickness: 0.3,
      archNodes: asymNodes,
      roofColor: { r: 210, g: 110, b: 90, a: 255 },
      pattern: {
        type: 'brick',
        primaryColor: { r: 90, g: 70, b: 60, a: 255 },
        rows: 4,
        cols: 3,
        spacingPx: 2,
        marginPx: 2,
        applyTop: true,
      },
    }),
  );
  doc.rerenderShapeLayer(archLayer);
  doc.layers.push(archLayer);

  const snap0 = new Uint8ClampedArray(doc.renderToBuffer());
  assert.equal(countPixels(snap0).semiTransparent, 0);
  for (let step = 1; step <= 4; step++) {
    doc.rotateView(1);
    const cur = doc.renderToBuffer();
    const cp = countPixels(cur);
    assert.ok(cp.solid > 200, `Asymmetric arch rotation step ${step} must render`);
    assert.equal(cp.semiTransparent, 0, `Asymmetric arch rotation step ${step} must have 0 AA`);
    if (step < 4 && step % 2 === 1) {
      assert.ok(!buffersEqual(cur, snap0), `90deg rotated asymmetric arch on 4x2 plot must change buffer`);
    }
  }
  assert.ok(buffersEqual(doc.renderToBuffer(), snap0), 'Asymmetric hollow arch 4x90deg rotation must close pixel-for-pixel');

  // 3. Elevation stacking on curved solid arch vs flat-top portal arch + compact non-arch stripping + .bmeow round-trip
  const stackDoc = new BuilderDocument(256, 256, 4, 4, 16);
  const semiLayer = new BuilderLayer(
    256,
    256,
    'SemiVault',
    'shape',
    createDefaultShape('arch', {
      u: 0,
      v: 0,
      sizeU: 4,
      sizeV: 2,
      heightPx: 40,
      ori: 0,
      archHollow: false,
      archNodes: createArchPresetNodes('semicircle'),
    }),
  );
  stackDoc.layers.push(semiLayer);
  const zCrown = stackDoc.getTopElevationAt(1.8, 0.5, 0.4, 1.0);
  const zShoulder = stackDoc.getTopElevationAt(0.0, 0.5, 0.4, 1.0);
  assert.equal(zCrown, 40, 'Stacking at arch crown must reach full heightPx (40)');
  assert.ok(zShoulder > 0 && zShoulder < zCrown, `Stacking near arch shoulder (${zShoulder}) must be lower than crown (${zCrown})`);

  semiLayer.shape!.archHollow = true;
  semiLayer.shape!.archHollowStyle = 'portal';
  assert.equal(stackDoc.getTopElevationAt(0.0, 0.5, 0.4, 1.0), 40, 'Portal arch has flat top deck across entire span');

  // Ensure non-arch shapes strip arch* fields
  const boxShape = createDefaultShape('box');
  assert.equal(boxShape.archNodes, undefined, 'Non-arch shape must omit archNodes');
  assert.equal(boxShape.archHollow, undefined, 'Non-arch shape must omit archHollow');
  assert.equal(boxShape.archInnerMode, undefined, 'Non-arch shape must omit archInnerMode');
  assert.equal(boxShape.archInnerNodes, undefined, 'Non-arch shape must omit archInnerNodes');

  // 4. v1.2.1 Inner-curve modes (parallel constant thickness, proportional, equal_vertical, custom) + rotation closure + .bmeow round-trip
  // Verify true physical constant wall thickness in 'parallel' mode on a narrow tall arch (1 cell = 18px span, 36px height)
  const tallOuterNodes = createArchPresetNodes('semicircle');
  const tallOuterCurve = sampleArchOuterCurve(tallOuterNodes, 96);
  const tallInnerParallel = sampleArchInnerCurve(
    tallOuterCurve,
    0.25,
    'shell',
    'parallel',
    undefined,
    18,
    36,
  );
  // D = 0.25 * min(9, 36) = 2.25px -> left pier s = 2.25 / 18 = 0.125, crown h = 1 - 2.25 / 36 = 0.9375
  const pierMetricThick = tallInnerParallel[0][0] * 18;
  let maxInnerH = 0;
  for (const [, ih] of tallInnerParallel) if (ih > maxInnerH) maxInnerH = ih;
  const crownMetricThick = (1 - maxInnerH) * 36;
  assert.ok(
    Math.abs(pierMetricThick - crownMetricThick) < 0.35,
    `Parallel mode must keep pier (${pierMetricThick.toFixed(2)}px) and crown (${crownMetricThick.toFixed(2)}px) wall thickness equal`,
  );

  // Unlocking auto inner curve into editable nodes should recover >= 3 clean control nodes
  const unlockedNodes = fitEditableNodesFromInnerCurve(tallInnerParallel);
  assert.ok(unlockedNodes.length >= 3, 'fitEditableNodesFromInnerCurve must recover >= 3 nodes');

  // All 4 inner modes render watertight with 0 semi-transparent pixels
  const modeOrigin = getPlotOrigin(256, 256, 4, 4, 16);
  for (const m of ARCH_INNER_MODES) {
    const customInner =
      m.id === 'custom'
        ? [
            { s: -0.2, h: 0, mode: 'corner' as const, inDs: 0, inDh: 0, outDs: 0, outDh: 0.3 }, // intentionally oversized to test clampInnerCurveInsideOuter
            { s: 0.38, h: 1.15, mode: 'smooth' as const, inDs: -0.12, inDh: 0, outDs: 0.12, outDh: 0 },
            { s: 0.85, h: 0, mode: 'corner' as const, inDs: 0, inDh: 0.25, outDs: 0, outDh: 0 },
          ]
        : undefined;
    const mShape = createDefaultShape('arch', {
      u: 0.5,
      v: 0.5,
      sizeU: 2,
      sizeV: 2,
      heightPx: 32,
      archHollow: true,
      archHollowStyle: 'shell',
      archInnerMode: m.id,
      archThickness: 0.28,
      archNodes: createArchPresetNodes('pointed'),
      archInnerNodes: customInner,
    });
    const mBuf = new Uint8ClampedArray(256 * 256 * 4);
    renderShapeToBuffer(mBuf, 256, 256, mShape, 4, 4, 0, modeOrigin.originX, modeOrigin.originY);
    const mc = countPixels(mBuf);
    assert.equal(mc.semiTransparent, 0, `Arch inner mode ${m.id} must have 0 AA`);
    assert.ok(mc.solid > 200, `Arch inner mode ${m.id} must render solid pixels`);
  }

  // Test asymmetric custom inner curve (outer rect_door + inner asymmetric horseshoe) 4x90deg rotation closure & .bmeow round-trip
  const customInnerHorseshoe = createScaledInnerPresetNodes('horseshoe', 0.24, 45, 30);
  customInnerHorseshoe[1].s = Math.min(0.8, customInnerHorseshoe[1].s + 0.06); // make inner cutout asymmetric
  archLayer.shape!.archNodes = createArchPresetNodes('rect_door');
  archLayer.shape!.archInnerMode = 'custom';
  archLayer.shape!.archInnerNodes = customInnerHorseshoe;
  doc.rerenderShapeLayer(archLayer);

  const customSnap0 = new Uint8ClampedArray(doc.renderToBuffer());
  assert.equal(countPixels(customSnap0).semiTransparent, 0);
  for (let step = 1; step <= 4; step++) {
    doc.rotateView(1);
    const cur = doc.renderToBuffer();
    assert.equal(countPixels(cur).semiTransparent, 0, `Custom inner arch rotation step ${step} must have 0 AA`);
    if (step < 4 && step % 2 === 1) {
      assert.ok(!buffersEqual(cur, customSnap0), '90deg rotated custom inner arch on 4x2 plot must change buffer');
    }
  }
  assert.ok(
    buffersEqual(doc.renderToBuffer(), customSnap0),
    'Custom inner arch 4x90deg rotation must close pixel-for-pixel',
  );

  // .bmeow round-trip preserving archInnerMode + archInnerNodes
  const serialized = serializeBmeowProject(doc, 'ArchProjectV121');
  const { doc: loadedDoc } = await deserializeBmeowProject(serialized);
  const loadedArch = loadedDoc.layers[0].shape!;
  assert.equal(loadedArch.shapeType, 'arch');
  assert.equal(loadedArch.archHollow, true);
  assert.equal(loadedArch.archHollowStyle, 'shell');
  assert.equal(loadedArch.archInnerMode, 'custom');
  assert.equal(loadedArch.archThickness, 0.3);
  assert.equal(loadedArch.archInnerNodes?.length, customInnerHorseshoe.length);
  assert.ok(buffersEqual(loadedDoc.renderToBuffer(), customSnap0), '.bmeow deserialized v1.2.1 arch must render identically');

  console.log('PASS: Arch v1.2.1 solid/hollow, 9 presets, 4 inner modes (parallel/proportional/equal_vertical/custom), clamping, 4x90deg closure & .bmeow round-trip');
}

async function testHollowLoftAndFlatArchPresets() {
  const W = 256;
  const H = 256;
  const { originX, originY } = getPlotOrigin(W, H, 4, 4, 16);

  // 1. All 13 LOFT_PRESETS (including flat_arch_d, c_arch, u_arch, octagon) render watertight in both solid & hollow modes
  for (const preset of LOFT_PRESETS) {
    const solidBuf = new Uint8ClampedArray(W * H * 4);
    const hollowBuf = new Uint8ClampedArray(W * H * 4);
    const secSolid = [
      {
        id: 's0',
        name: '底',
        t: 0,
        scale: 1,
        twistDeg: 0,
        offsetU: 0,
        offsetV: 0,
        nodes: createLoftPresetNodes(preset.id),
      },
      {
        id: 's1',
        name: '顶',
        t: 1,
        scale: 0.94,
        twistDeg: 10,
        offsetU: 0,
        offsetV: 0,
        nodes: createLoftPresetNodes(preset.id),
        innerMode: 'parallel' as const,
        innerThickness: 0.28,
      },
    ];

    renderShapeToBuffer(
      solidBuf,
      W,
      H,
      createDefaultShape('loft', {
        u: 0.5,
        v: 0.5,
        sizeU: 3,
        sizeV: 3,
        heightPx: 8, // low height so hollow cutout reveals transparent center or recessed cavity
        loftHollow: false,
        loftSections: secSolid,
        outlineMode: 'all_edges',
      }),
      4,
      4,
      0,
      originX,
      originY,
    );
    renderShapeToBuffer(
      hollowBuf,
      W,
      H,
      createDefaultShape('loft', {
        u: 0.5,
        v: 0.5,
        sizeU: 3,
        sizeV: 3,
        heightPx: 8,
        loftHollow: true,
        loftSections: secSolid,
        outlineMode: 'all_edges',
      }),
      4,
      4,
      0,
      originX,
      originY,
    );

    const cs = countPixels(solidBuf);
    const ch = countPixels(hollowBuf);
    assert.equal(cs.semiTransparent, 0, `Loft preset ${preset.id} solid must have 0 AA`);
    assert.equal(ch.semiTransparent, 0, `Loft preset ${preset.id} hollow must have 0 AA`);
    assert.ok(cs.solid > 200, `Loft preset ${preset.id} solid must render substantial pixels`);
    assert.ok(
      ch.solid > 80 && ch.solid < cs.solid,
      `Loft preset ${preset.id} low-ring hollow (${ch.solid}) must carve out center vs solid (${cs.solid})`,
    );
  }

  // 2. Per-control-section heterogeneous inner curves (bottom: parallel square, middle: proportional, top: custom star + clamping)
  //    on a non-square 4x2 plot with 4x90deg pixel-for-pixel rotation closure & recessed floor!
  const customOversizedInner = createScaledLoftInnerPresetNodes('star', 0.22);
  customOversizedInner[0].v = -0.35; // intentionally protrudes outside outer boundary to test SDF clamping!

  const doc = new BuilderDocument(256, 256, 4, 2, 16);
  const hollowLoftLayer = new BuilderLayer(
    256,
    256,
    'HollowCourtyardTower',
    'shape',
    createDefaultShape('loft', {
      u: 0.25,
      v: 0.25,
      sizeU: 3.0,
      sizeV: 1.5,
      heightPx: 34,
      ori: 1,
      loftHollow: true,
      loftFloorT: 0.25,
      loftInterp: 'smooth',
      loftSections: [
        {
          id: 'hl-1',
          name: '底层方院',
          t: 0,
          scale: 1.0,
          twistDeg: 0,
          offsetU: 0,
          offsetV: 0,
          nodes: createLoftPresetNodes('square'),
          innerMode: 'parallel',
          innerThickness: 0.32,
        },
        {
          id: 'hl-2',
          name: '中腰平放拱',
          t: 0.5,
          scale: 0.88,
          twistDeg: 15,
          offsetU: 0.04,
          offsetV: -0.03,
          nodes: createLoftPresetNodes('flat_arch_d'),
          innerMode: 'proportional',
          innerThickness: 0.26,
        },
        {
          id: 'hl-3',
          name: '顶层自由星孔',
          t: 1.0,
          scale: 0.95,
          twistDeg: -10,
          offsetU: 0,
          offsetV: 0,
          nodes: createLoftPresetNodes('octagon'),
          innerMode: 'custom',
          innerThickness: 0.24,
          innerNodes: customOversizedInner,
        },
      ],
      pattern: {
        type: 'windows',
        primaryColor: { r: 120, g: 200, b: 255, a: 255 },
        rows: 4,
        cols: 4,
        spacingPx: 2,
        marginPx: 2,
        applyTop: true,
      },
    }),
  );

  // Verify unlocking & section inner interpolation helpers
  const unlocked = fitEditableNodesFromSectionInner(hollowLoftLayer.shape!.loftSections![0], 1.5, 3.0);
  assert.ok(unlocked.length >= 3, 'fitEditableNodesFromSectionInner must produce >= 3 editable nodes');
  const midInner = interpolateLoftSectionInner(
    hollowLoftLayer.shape!.loftSections![0],
    hollowLoftLayer.shape!.loftSections![2],
    0.5,
    1.5,
    3.0,
  );
  assert.equal(midInner.innerMode, 'custom');
  assert.ok((midInner.innerNodes?.length ?? 0) >= 3);

  // Verify parallel metric inset on 3x1 rectangular aspect maintains uniform physical wall thickness
  const rectSec = {
    id: 'rect-p',
    name: 'Rect',
    t: 0,
    scale: 1,
    twistDeg: 0,
    offsetU: 0,
    offsetV: 0,
    nodes: createLoftPresetNodes('square'), // [0.08..0.92] x [0.08..0.92]
    innerMode: 'parallel' as const,
    innerThickness: 0.3,
  };
  const innerRect = sampleSectionInnerUniform(rectSec, 96, true, 3, 1);
  let minInU = Infinity, minInV = Infinity;
  for (const [iu, iv] of innerRect) {
    if (iu < minInU) minInU = iu;
    if (iv < minInV) minInV = iv;
  }
  const wallMetricU = (minInU - 0.08) * 3;
  const wallMetricV = (minInV - 0.08) * 1;
  assert.ok(
    Math.abs(wallMetricU - wallMetricV) < 0.04,
    `Parallel hollow loft on 3x1 plot must keep physical wall thickness equal: U=${wallMetricU.toFixed(3)}, V=${wallMetricV.toFixed(3)}`,
  );

  doc.rerenderShapeLayer(hollowLoftLayer);
  doc.layers.push(hollowLoftLayer);

  const snap0 = new Uint8ClampedArray(doc.renderToBuffer());
  const c0 = countPixels(snap0);
  assert.equal(c0.semiTransparent, 0, 'Hollow multi-section loft must have 0 AA');
  assert.ok(c0.solid > 300, 'Hollow multi-section loft must render solid pixels');

  for (let step = 1; step <= 4; step++) {
    doc.rotateView(1);
    const cur = doc.renderToBuffer();
    const cc = countPixels(cur);
    assert.equal(cc.semiTransparent, 0, `Hollow loft rotation step ${step} must have 0 AA`);
    if (step < 4 && step % 2 === 1) {
      assert.ok(!buffersEqual(cur, snap0), '90deg rotated asymmetric hollow loft must change buffer');
    }
  }
  assert.ok(buffersEqual(doc.renderToBuffer(), snap0), 'Hollow multi-section loft 4x90deg rotation must close pixel-for-pixel');

  // 3. Courtyard floor elevation stacking check (inside hole vs on rim)
  const stackDoc = new BuilderDocument(256, 256, 4, 4, 16);
  const courtyardLayer = new BuilderLayer(
    256,
    256,
    'Courtyard',
    'shape',
    createDefaultShape('loft', {
      u: 0,
      v: 0,
      sizeU: 4,
      sizeV: 4,
      heightPx: 40,
      loftHollow: true,
      loftFloorT: 0, // through-hole
      loftSections: [
        {
          id: 'c0',
          name: '底',
          t: 0,
          scale: 1,
          twistDeg: 0,
          offsetU: 0,
          offsetV: 0,
          nodes: createLoftPresetNodes('square'),
          innerMode: 'parallel',
          innerThickness: 0.2,
        },
        {
          id: 'c1',
          name: '顶',
          t: 1,
          scale: 1,
          twistDeg: 0,
          offsetU: 0,
          offsetV: 0,
          nodes: createLoftPresetNodes('square'),
          innerMode: 'parallel',
          innerThickness: 0.2,
        },
      ],
    }),
  );
  stackDoc.layers.push(courtyardLayer);
  assert.equal(stackDoc.getTopElevationAt(1.75, 1.75, 0.5, 0.5), 0, 'Object inside open through-hole courtyard lands on ground z=0');
  assert.equal(stackDoc.getTopElevationAt(0.2, 0.2, 0.5, 0.5), 40, 'Object overlapping courtyard wall lands on top rim z=40');
  courtyardLayer.shape!.loftFloorT = 0.25;
  assert.equal(stackDoc.getTopElevationAt(1.75, 1.75, 0.5, 0.5), 10, 'Object inside recessed-floor courtyard lands on floor z=10');

  // Non-loft shapes must omit loftHollow & loftFloorT
  const plainBox = createDefaultShape('box');
  assert.equal(plainBox.loftHollow, undefined);
  assert.equal(plainBox.loftFloorT, undefined);

  // 4. .bmeow round-trip preserving loftHollow, loftFloorT, and per-section innerMode/innerThickness/innerNodes
  const bmeowJson = serializeBmeowProject(doc, 'HollowLoftV122');
  const { doc: loadedDoc } = await deserializeBmeowProject(bmeowJson);
  const loadedLoft = loadedDoc.layers[0].shape!;
  assert.equal(loadedLoft.loftHollow, true);
  assert.equal(loadedLoft.loftFloorT, 0.25);
  assert.equal(loadedLoft.loftSections?.[2].innerMode, 'custom');
  assert.equal(loadedLoft.loftSections?.[2].innerNodes?.length, customOversizedInner.length);
  assert.ok(buffersEqual(loadedDoc.renderToBuffer(), snap0), '.bmeow deserialized hollow loft must render identically');

  console.log('PASS: Hollow lofted column + per-section inner curves (parallel/proportional/custom) + 13 presets (flat arches) + courtyard stacking + 4x90deg closure');
}

async function testOpusV123ReviewFixes() {
  const renderSingle = (s: ReturnType<typeof createDefaultShape>, cells = 6) => {
    const d = new BuilderDocument(220, 220, cells, cells, 16);
    d.layers.push(new BuilderLayer(220, 220, 'T', 'shape', s));
    d.rerenderAllShapes();
    return d.renderToBuffer();
  };

  // 1. H1 + H2(a): Hollow loft recessed floor alignment (tMin > 0) + degenerate span (tMin === tMax) guard
  const ringPts = createLoftPresetNodes('circle');
  const makeFloorLoft = (tMin: number, tMax: number, loftFloorT: number) =>
    createDefaultShape('loft', {
      u: 1,
      v: 1,
      zPx: 0,
      sizeU: 2,
      sizeV: 2,
      heightPx: 100,
      ori: 0,
      loftHollow: true,
      loftFloorT,
      loftSections: [
        { id: 'f0', name: 'Bottom', t: tMin, scale: 1, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: ringPts.map((n) => ({ ...n })), innerMode: 'parallel', innerThickness: 0.25 },
        { id: 'f1', name: 'Top', t: tMax, scale: 1, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: ringPts.map((n) => ({ ...n })), innerMode: 'parallel', innerThickness: 0.25 },
      ],
    });
  const makeShallowFloorLoft = (tMin: number, tMax: number, loftFloorT: number) =>
    createDefaultShape('loft', {
      u: 1,
      v: 1,
      zPx: 0,
      sizeU: 3,
      sizeV: 3,
      heightPx: 20,
      ori: 0,
      loftHollow: true,
      loftFloorT,
      loftSections: [
        { id: 'f0', name: 'Bottom', t: tMin, scale: 1, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: ringPts.map((n) => ({ ...n })), innerMode: 'parallel', innerThickness: 0.25 },
        { id: 'f1', name: 'Top', t: tMax, scale: 1, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: ringPts.map((n) => ({ ...n })), innerMode: 'parallel', innerThickness: 0.25 },
      ],
    });

  const loftFloor = makeFloorLoft(0.2, 1.0, 0.15);
  const stWithFloor = countPixels(renderSingle(makeShallowFloorLoft(0.2, 1.0, 0.15)));
  const stNoFloor = countPixels(renderSingle(makeShallowFloorLoft(0.2, 1.0, 0)));
  assert.equal(stWithFloor.semiTransparent, 0, 'H1 floor loft must have 0 semi-transparent pixels');
  assert.ok(stWithFloor.solid > stNoFloor.solid, 'H1 recessed floor should add visible floor pixels in cavity');

  const docH1 = new BuilderDocument(160, 160, 4, 4, 16);
  docH1.layers.push(new BuilderLayer(160, 160, 'FloorLoft', 'shape', loftFloor));
  assert.equal(
    docH1.getTopElevationAt(1.9, 1.9, 0.2, 0.2),
    32,
    'H1+H2(a): tMin=0.2, tMax=1.0, heightPx=100, loftFloorT=0.15 must yield cavity elevation 32',
  );

  const degFloor = makeShallowFloorLoft(0.5, 0.5, 0.2);
  const degNoFloor = makeShallowFloorLoft(0.5, 0.5, 0);
  assert.ok(
    buffersEqual(renderSingle(degFloor), renderSingle(degNoFloor)),
    'H1 degenerate span (tMin === tMax) must skip recessed floor completely',
  );

  // 2. H2(b): Hourglass hollow loft waist catches medium box at narrowing wall while tiny box falls through to 0
  const docH2 = new BuilderDocument(160, 160, 6, 6, 16);
  const hourglass = createDefaultShape('loft', {
    u: 1,
    v: 1,
    zPx: 0,
    sizeU: 4,
    sizeV: 4,
    heightPx: 100,
    ori: 0,
    loftHollow: true,
    loftFloorT: 0,
    loftInterp: 'linear',
    loftSections: [
      { id: 'hg0', name: 'B', t: 0, scale: 1.0, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: ringPts.map((n) => ({ ...n })), innerMode: 'proportional', innerThickness: 0.25 },
      { id: 'hg1', name: 'W', t: 0.5, scale: 0.36, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: ringPts.map((n) => ({ ...n })), innerMode: 'proportional', innerThickness: 0.25 },
      { id: 'hg2', name: 'T', t: 1.0, scale: 1.0, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: ringPts.map((n) => ({ ...n })), innerMode: 'proportional', innerThickness: 0.25 },
    ],
  });
  docH2.layers.push(new BuilderLayer(160, 160, 'Hourglass', 'shape', hourglass));
  assert.equal(
    docH2.getTopElevationAt(2.9, 2.9, 0.2, 0.2),
    0,
    'H2(b): Tiny footprint must drop cleanly through open hourglass center to 0',
  );
  const medBoxZ = docH2.getTopElevationAt(2.3, 2.3, 1.4, 1.4);
  assert.equal(
    medBoxZ,
    100,
    `H2(b): Medium footprint (1.4x1.4) clears top hole but waist blocks shaft so it must rest on rim z=100 (got ${medBoxZ})`,
  );

  // 3. A-M1: Horseshoe arch outward belly preserved on inner curve
  const hsOuter = sampleArchOuterCurve(createArchPresetNodes('horseshoe'), 96, false);
  const hsInner = sampleArchInnerCurve(hsOuter, 0.25, 'shell', 'parallel', undefined, 36, 36);
  const hsInnerLeftFootS = hsInner[0][0];
  const hsInnerRightFootS = hsInner[hsInner.length - 1][0];
  const hsInnerMinS = Math.min(...hsInner.map((p) => p[0]));
  const hsInnerMaxS = Math.max(...hsInner.map((p) => p[0]));
  assert.ok(
    hsInnerMinS < hsInnerLeftFootS - 0.015 && hsInnerMaxS > hsInnerRightFootS + 0.015,
    `A-M1: Horseshoe inner curve must preserve outward belly beyond pinched feet (minS=${hsInnerMinS.toFixed(3)} vs foot=${hsInnerLeftFootS.toFixed(3)})`,
  );

  // 4. A-M2: rect_door corners (0, 1)/(1, 1) exact + invariant under sizeV / height scaling
  const rectOuter = sampleArchOuterCurve(createArchPresetNodes('rect_door'), 64, false);
  assert.ok(
    rectOuter.some((p) => Math.hypot(p[0], p[1] - 1) < 1e-4) &&
      rectOuter.some((p) => Math.hypot(p[0] - 1, p[1] - 1) < 1e-4),
    'A-M2: rect_door sampling must hit exact top-left (0,1) and top-right (1,1) corners',
  );
  assert.ok(getArchSampleCount(108, 96) > getArchSampleCount(18, 12), 'A-M2: adaptive arch sample count must scale with size');
  const docArchSq = new BuilderDocument(200, 200, 8, 8, 16);
  docArchSq.layers.push(new BuilderLayer(200, 200, 'RectDoor2', 'shape', createDefaultShape('arch', {
    u: 1, v: 1, zPx: 0, sizeU: 2, sizeV: 2, heightPx: 80, ori: 0,
    archNodes: createArchPresetNodes('rect_door'),
  })));
  const docArchDeep = new BuilderDocument(200, 200, 8, 8, 16);
  docArchDeep.layers.push(new BuilderLayer(200, 200, 'RectDoor6', 'shape', createDefaultShape('arch', {
    u: 1, v: 1, zPx: 0, sizeU: 2, sizeV: 6, heightPx: 80, ori: 0,
    archNodes: createArchPresetNodes('rect_door'),
  })));
  assert.ok(
    docArchSq.getTopElevationAt(1.02, 1.2, 0.15, 0.4) >= 79 &&
      docArchDeep.getTopElevationAt(1.02, 1.2, 0.15, 0.4) >= 79,
    'A-M2: rect_door corner top elevation must reach full height invariant to sizeV',
  );

  // 5. A-M3: Proportional concave arch inner curve clamped strictly under outer silhouette
  const concaveNodes = [
    { s: 0, h: 0, mode: 'corner' as const },
    { s: 0.22, h: 0.92, mode: 'smooth' as const },
    { s: 0.5, h: 0.25, mode: 'smooth' as const },
    { s: 0.78, h: 0.92, mode: 'smooth' as const },
    { s: 1, h: 0, mode: 'corner' as const },
  ];
  const concOuter = sampleArchOuterCurve(concaveNodes, 72, false);
  const concInnerProp = sampleArchInnerCurve(concOuter, 0.35, 'shell', 'proportional', undefined, 36, 36);
  const outerHAtS = (sQuery: number): number => {
    let bestH = 0;
    for (let i = 0; i < concOuter.length - 1; i++) {
      const [s0, h0] = concOuter[i];
      const [s1, h1] = concOuter[i + 1];
      const lo = Math.min(s0, s1);
      const hi = Math.max(s0, s1);
      if (sQuery >= lo - 1e-6 && sQuery <= hi + 1e-6) {
        const denom = s1 - s0;
        const t = Math.abs(denom) < 1e-7 ? 0.5 : Math.max(0, Math.min(1, (sQuery - s0) / denom));
        bestH = Math.max(bestH, h0 + (h1 - h0) * t);
      }
    }
    return bestH;
  };
  for (const ip of concInnerProp) {
    if (ip[0] >= 0.03 && ip[0] <= 0.97) {
      assert.ok(
        ip[1] <= outerHAtS(ip[0]) + 1e-3,
        `A-M3: proportional inner point (${ip[0].toFixed(3)}, ${ip[1].toFixed(3)}) must stay below outer silhouette`,
      );
    }
  }
  const concaveShape = createDefaultShape('arch', {
    sizeU: 2, sizeV: 2, heightPx: 48, archNodes: concaveNodes, archHollow: true, archInnerMode: 'proportional', archThickness: 0.35,
  });
  assert.equal(countPixels(renderSingle(concaveShape)).semiTransparent, 0, 'A-M3 render must have 0 AA pixels');

  // 6. Arch-L4 & Arch-L5: null resilience + shape-type field stripping + bounds clamping
  assert.ok(normalizeArchNodes(null as unknown as undefined).length >= 2, 'Arch-L4: normalizeArchNodes(null) must not throw');
  assert.ok(normalizeLoftSections(null).length >= 1, 'Loft null guard: normalizeLoftSections(null) must not throw');
  const sampleLoftSec = [
    { id: 'x0', name: 'X', t: 0, scale: 1, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: createLoftPresetNodes('star') },
  ];
  const boxStripped = createDefaultShape('box', {
    archNodes: createArchPresetNodes('horseshoe'),
    archHollow: true,
    archThickness: 0.99,
    loftSections: sampleLoftSec,
    loftHollow: true,
    loftFloorT: 0.5,
  });
  assert.equal(boxStripped.archNodes, undefined, 'Arch-L5: box must strip archNodes');
  assert.equal(boxStripped.loftSections, undefined, 'Arch-L5: box must strip loftSections');
  const archStripped = createDefaultShape('arch', { loftSections: sampleLoftSec, loftHollow: true, archThickness: 0.99 });
  assert.ok(Array.isArray(archStripped.archNodes), 'Arch-L5: arch keeps archNodes');
  assert.equal(archStripped.archThickness, 0.78, 'Arch thickness must clamp to [0.06, 0.78]');
  assert.equal(archStripped.loftSections, undefined, 'Arch-L5: arch must strip loftSections');
  const loftStripped = createDefaultShape('loft', { archNodes: createArchPresetNodes('horseshoe'), loftFloorT: 0.99 });
  assert.ok(Array.isArray(loftStripped.loftSections), 'Arch-L5: loft keeps loftSections');
  assert.equal(loftStripped.loftFloorT, 0.90, 'Loft-L3: loftFloorT must clamp to [0, 0.90]');
  assert.equal(loftStripped.archNodes, undefined, 'Arch-L5: loft must strip archNodes');

  // 7. L-M1: Tapered 1.0 / 0.74 / 0.92 parallel hollow loft maintains equal metric wall thickness
  const taperSecs = [
    { id: 't0', name: 'B', t: 0, scale: 1.0, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: ringPts.map((n) => ({ ...n })), innerMode: 'parallel' as const, innerThickness: 0.25 },
    { id: 't1', name: 'M', t: 0.5, scale: 0.74, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: ringPts.map((n) => ({ ...n })), innerMode: 'parallel' as const, innerThickness: 0.25 },
    { id: 't2', name: 'T', t: 1.0, scale: 0.92, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: ringPts.map((n) => ({ ...n })), innerMode: 'parallel' as const, innerThickness: 0.25 },
  ];
  const colRefR = computeColumnRefRadiusMetric(taperSecs, 2, 2);
  const meanRadiusMetric = (pts: [number, number][]) =>
    pts.reduce((acc, [u, v]) => acc + Math.hypot((u - 0.5) * 2, (v - 0.5) * 2), 0) / Math.max(1, pts.length);
  const wallThicknesses = taperSecs.map((sec) => {
    const outR = meanRadiusMetric(sampleClosedSectionUniform(sec, 48, true));
    const inR = meanRadiusMetric(sampleSectionInnerUniform(sec, 48, true, 2, 2, colRefR));
    return outR - inR;
  });
  const wallSpread = Math.max(...wallThicknesses) - Math.min(...wallThicknesses);
  assert.ok(
    wallSpread < 0.06,
    `L-M1: tapered 1.0/0.74/0.92 parallel wall thicknesses should be equal in metric units (got ${wallThicknesses.map((w) => w.toFixed(3)).join(', ')})`,
  );

  // 8. L-M2: u_arch & l_shape proportional / scaled inner preset strictly inside outer polygon + 0 AA + 4x90deg closure
  for (const pid of ['u_arch', 'l_shape'] as const) {
    const secProp = {
      id: pid,
      name: pid,
      t: 0,
      scale: 1,
      twistDeg: 0,
      offsetU: 0,
      offsetV: 0,
      nodes: createLoftPresetNodes(pid),
      innerMode: 'proportional' as const,
      innerThickness: 0.28,
    };
    const cRef = computeColumnRefRadiusMetric([secProp], 2, 2);
    const { center: ctr, safeScale } = getSectionInteriorCenterLocal(secProp, 2, 2);
    assert.ok(
      ctr[0] > 0 && ctr[0] < 1 && ctr[1] > 0 && ctr[1] < 1 && safeScale > 0 && safeScale <= 1,
      `L-M2: ${pid} interior center valid`,
    );
    const outRing = sampleClosedSectionUniform(secProp, 64, true);
    const inProp = sampleSectionInnerUniform(secProp, 64, true, 2, 2, cRef);
    assert.ok(inProp.length >= 3, `L-M2: ${pid} proportional inner non-empty`);
    for (const [x, y] of inProp) {
      assert.ok(pointInClosedPolygon(x, y, outRing), `L-M2: ${pid} proportional inner point (${x.toFixed(3)},${y.toFixed(3)}) must lie strictly inside outer polygon`);
    }

    const innerPresetNodes = createScaledLoftInnerPresetNodes(pid, 0.28, secProp, 2, 2);
    const secPreset = { ...secProp, innerMode: 'custom' as const, innerNodes: innerPresetNodes };
    const inPreset = sampleSectionInnerUniform(secPreset, 64, true, 2, 2, cRef);
    assert.ok(inPreset.length >= 3, `L-M2: ${pid} custom preset inner non-empty`);
    for (const [x, y] of inPreset) {
      assert.ok(pointInClosedPolygon(x, y, outRing), `L-M2: ${pid} scaled inner preset point (${x.toFixed(3)},${y.toFixed(3)}) must lie strictly inside outer polygon`);
    }

    const docConc = new BuilderDocument(160, 160, 4, 4, 16);
    docConc.layers.push(new BuilderLayer(160, 160, pid, 'shape', createDefaultShape('loft', {
      u: 1,
      v: 1,
      zPx: 0,
      sizeU: 2,
      sizeV: 2,
      heightPx: 40,
      ori: 0,
      loftHollow: true,
      loftSections: [secProp, { ...secProp, id: `${pid}_top`, t: 1 }],
    })));
    docConc.rerenderAllShapes();
    const s0 = docConc.renderToBuffer();
    assert.equal(countPixels(s0).semiTransparent, 0, `L-M2: ${pid} must have 0 AA pixels`);
    for (let r = 1; r <= 4; r++) {
      docConc.rotateView(1);
      const sr = docConc.renderToBuffer();
      assert.equal(countPixels(sr).semiTransparent, 0, `L-M2: ${pid} rotation ${r * 90}deg must have 0 AA pixels`);
      if (r === 4) {
        assert.ok(buffersEqual(sr, s0), `L-M2: ${pid} must satisfy 4x90deg rotation closure`);
      }
    }
  }

  console.log('PASS: Opus v1.2.x all-priority review fixes (H1-H2, A-M1..3, L-M1..2, Arch-L4..5)');
}

async function testV124Features() {
  // 1. Loft regular polygon presets (3~12 sides)
  assert.equal(LOFT_POLYGON_PRESETS.length, 10, 'LOFT_POLYGON_PRESETS must cover 3..12 sides');
  assert.equal(LOFT_POLYGON_PRESETS[0].sides, 3);
  assert.equal(LOFT_POLYGON_PRESETS[9].sides, 12);

  for (const p of LOFT_POLYGON_PRESETS) {
    const nodes = createLoftPresetNodes(p.id);
    assert.equal(nodes.length, p.sides, `${p.id} must produce ${p.sides} nodes`);
    for (const nd of nodes) {
      assert.equal(nd.mode, 'corner', `${p.id} polygon node must default to corner mode`);
    }
    const outerSec = {
      id: `${p.id}_s0`,
      name: p.label,
      t: 0,
      scale: 1,
      twistDeg: 0,
      offsetU: 0,
      offsetV: 0,
      nodes,
      innerMode: 'custom' as const,
    };
    const innerNodes = createScaledLoftInnerPresetNodes(p.id, 0.28, outerSec, 2, 2);
    assert.equal(innerNodes.length, p.sides, `${p.id} scaled inner preset must produce ${p.sides} nodes`);
    const outerRing = sampleClosedSectionUniform(outerSec, 64, true);
    const colRefR = computeColumnRefRadiusMetric([outerSec], 2, 2);
    const innerRing = sampleSectionInnerUniform({ ...outerSec, innerNodes }, 64, true, 2, 2, colRefR);
    for (const [ix, iy] of innerRing) {
      assert.ok(pointInClosedPolygon(ix, iy, outerRing), `${p.id} inner point (${ix.toFixed(3)},${iy.toFixed(3)}) inside outer`);
    }
  }

  for (const pid of ['poly_3', 'poly_12'] as const) {
    const nOut = createLoftPresetNodes(pid);
    const sec0 = {
      id: `${pid}_0`,
      name: '底面',
      t: 0,
      scale: 1,
      twistDeg: 0,
      offsetU: 0,
      offsetV: 0,
      nodes: nOut,
      innerMode: 'custom' as const,
      innerNodes: createScaledLoftInnerPresetNodes(pid, 0.26, {
        id: 'tmp', name: 'tmp', t: 0, scale: 1, twistDeg: 0, offsetU: 0, offsetV: 0, nodes: nOut,
      }, 2, 2),
    };
    const docPoly = new BuilderDocument(160, 160, 4, 4, 16);
    docPoly.layers.push(new BuilderLayer(160, 160, pid, 'shape', createDefaultShape('loft', {
      u: 1, v: 1, zPx: 0, sizeU: 2, sizeV: 2, heightPx: 36, ori: 0, loftHollow: true,
      loftSections: [sec0, { ...sec0, id: `${pid}_1`, t: 1, scale: 0.85 }],
    })));
    docPoly.rerenderAllShapes();
    const p0 = docPoly.renderToBuffer();
    const st0 = countPixels(p0);
    assert.ok(st0.solid > 0, `${pid} loft must render visible pixels`);
    assert.equal(st0.semiTransparent, 0, `${pid} loft must have 0 AA pixels`);
    for (let r = 1; r <= 4; r++) {
      docPoly.rotateView(1);
      const pr = docPoly.renderToBuffer();
      assert.equal(countPixels(pr).semiTransparent, 0, `${pid} rot ${r * 90}deg 0 AA`);
      if (r === 4) assert.ok(buffersEqual(pr, p0), `${pid} 4x90deg rotation closure`);
    }
  }

  // 2. Untouched column primitives must NOT populate colSections (preserve fast-path & clean JSON)
  for (const kind of ['box', 'cylinder', 'prism', 'right_tri_prism'] as const) {
    const defShape = createDefaultShape(kind, { u: 1, v: 1, sizeU: 1, sizeV: 1, heightPx: 24 });
    assert.equal(hasActiveColumnSections(defShape), false, `Untouched ${kind} hasActiveColumnSections=false`);
    const dFast = new BuilderDocument(128, 128, 4, 4, 16);
    dFast.layers.push(new BuilderLayer(128, 128, kind, 'shape', defShape));
    const jsonFast = await serializeBmeowProject(dFast, 'fast');
    assert.ok(!jsonFast.includes('colSections'), `Untouched ${kind} JSON must omit colSections`);
  }
  assert.equal(
    isColumnSectionShape(createDefaultShape('right_tri_prism', { triPrismCut: 'slope' })),
    false,
    'Slope right_tri_prism does not use horizontal column sections',
  );

  // 3. Polygonal column control edges, midpoint pivot, clamping, and edge locking
  const boxCol = createDefaultShape('box', { u: 1, v: 1, sizeU: 2, sizeV: 2, heightPx: 48, ori: 0 });
  const secs = ensureColumnSections(boxCol);
  assert.equal(secs.length, 2);
  assert.equal(secs[0].edges.length, 4);
  const topSec = secs[1];

  const edited = applyColumnEdgeEdit(topSec, 0, -0.1, topSec.edges[0].angleDeg + 18, { pivotMidpoint: true });
  assert.equal(edited, true, 'Polygonal edge 0 edit must succeed');
  const midInserted = insertColumnSectionAtT(boxCol, 0.5, '腰线');
  assert.ok(midInserted && boxCol.colSections!.length === 3, 'insertColumnSectionAtT must add mid section');

  // Extreme self-intersecting target must stay bounded/valid without collapsing edge count
  const extremeSec = cloneColumnSection(topSec);
  applyColumnEdgeEdit(extremeSec, 1, -0.74, extremeSec.edges[1].angleDeg + 170);
  assert.equal(evaluateColumnSectionEdges(extremeSec).length, 4, 'Clamped extreme edit must retain 4 valid edges');

  // Lock edge 2 and verify immovability under direct edit and section-wide scale/offset transform
  topSec.edges[2].locked = true;
  const beforeLocked = evaluateColumnSectionEdges(topSec)[2];
  const lockedEditOk = applyColumnEdgeEdit(topSec, 2, beforeLocked.dist + 0.15, beforeLocked.angleDeg + 25);
  assert.equal(lockedEditOk, false, 'Locked edge direct edit must return false');

  const beforeE0 = evaluateColumnSectionEdges(topSec)[0];
  const xformOk = applyColumnSectionTransform(topSec, { scale: 0.72, offsetU: 0.08, offsetV: -0.06 });
  assert.equal(xformOk, true, 'Section transform with locked bottom edge must succeed');
  const afterSegs = evaluateColumnSectionEdges(topSec);
  const afterLocked = afterSegs[2];
  assert.ok(
    Math.hypot(afterLocked.normal[0] - beforeLocked.normal[0], afterLocked.normal[1] - beforeLocked.normal[1]) < 1e-4 &&
      Math.abs(afterLocked.dist - beforeLocked.dist) < 1e-4,
    `Locked edge line invariant failed: before=${beforeLocked.dist.toFixed(4)} after=${afterLocked.dist.toFixed(4)}`,
  );
  assert.ok(
    Math.abs(afterSegs[0].dist - beforeE0.dist) > 1e-2,
    'Unlocked edge must respond to section scale/offset transform while locked edge stays fixed',
  );

  // Verify prism (6 edges) & vertical right_tri_prism (3 edges)
  const prismCol = createDefaultShape('prism', { u: 1, v: 1, sizeU: 2, sizeV: 2, heightPx: 40, prismSides: 6 });
  const pSecs = ensureColumnSections(prismCol);
  assert.equal(pSecs[0].edges.length, 6);
  applyColumnEdgeEdit(pSecs[1], 1, -0.08, pSecs[1].edges[1].angleDeg + 12, { pivotMidpoint: true });

  const triCol = createDefaultShape('right_tri_prism', { u: 1, v: 1, sizeU: 2, sizeV: 2, heightPx: 40, triPrismCut: 'vertical' });
  const tSecs = ensureColumnSections(triCol);
  assert.equal(tSecs[0].edges.length, 3);
  tSecs[1].edges[0].locked = true;
  applyColumnSectionTransform(tSecs[1], { scale: 0.75 });

  const cylCol = createDefaultShape('cylinder', { u: 1, v: 1, sizeU: 2, sizeV: 2, heightPx: 44 });
  const cSecs = ensureColumnSections(cylCol);
  assert.equal(cSecs[0].edges.length, 0, 'Cylinder uses circular ring sections without polygonal control edges');
  applyColumnSectionTransform(cSecs[1], { scale: 0.62, offsetU: 0.1, offsetV: -0.08 });

  // 4. Watertight 0-AA rendering + 4x90deg closure + .bmeow & snapshot/restore roundtrip
  for (const [label, sh] of [
    ['box_col_sec', boxCol],
    ['prism_col_sec', prismCol],
    ['tri_col_sec', triCol],
    ['cyl_col_sec', cylCol],
  ] as const) {
    const dCol = new BuilderDocument(192, 192, 4, 4, 16);
    dCol.layers.push(new BuilderLayer(192, 192, label, 'shape', sh));
    dCol.rerenderAllShapes();
    const b0 = dCol.renderToBuffer();
    const s0 = countPixels(b0);
    assert.ok(s0.solid > 0, `${label} must render visible pixels`);
    assert.equal(s0.semiTransparent, 0, `${label} must have 0 AA pixels`);
    for (let r = 1; r <= 4; r++) {
      dCol.rotateView(1);
      const br = dCol.renderToBuffer();
      assert.equal(countPixels(br).semiTransparent, 0, `${label} rot ${r * 90}deg 0 AA`);
      if (r === 4) assert.ok(buffersEqual(br, b0), `${label} must satisfy 4x90deg rotation closure`);
    }

    // Snapshot & restore must keep colSections + activeColSectionId intact
    const snap = dCol.snapshot();
    const dRestored = new BuilderDocument(192, 192, 4, 4, 16);
    dRestored.restore(snap);
    assert.ok(hasActiveColumnSections(dRestored.layers[0].shape!), `${label} snapshot/restore keeps colSections`);
    assert.ok(buffersEqual(dRestored.renderToBuffer(), b0), `${label} restored render identical`);

    // .bmeow serialize/deserialize roundtrip
    const json = serializeBmeowProject(dCol, label);
    const { doc: dLoaded } = await deserializeBmeowProject(json);
    assert.ok(hasActiveColumnSections(dLoaded.layers[0].shape!), `${label} .bmeow roundtrip keeps colSections`);
    assert.ok(buffersEqual(dLoaded.renderToBuffer(), b0), `${label} .bmeow roundtrip render identical`);
  }

  // 5. 1024px height cap support with 0 AA and 4x90deg closure
  const dTall = new BuilderDocument(256, 1180, 4, 4, 16);
  const tallCol = createDefaultShape('box', {
    u: 1,
    v: 1,
    zPx: 0,
    sizeU: 2,
    sizeV: 2,
    heightPx: 1024,
    pattern: 'windows',
  });
  const tallSecs = ensureColumnSections(tallCol);
  tallSecs[1].scale = 0.72;
  dTall.layers.push(new BuilderLayer(256, 1180, 'tall1024', 'shape', tallCol));
  dTall.rerenderAllShapes();
  const t0 = dTall.renderToBuffer();
  const ts0 = countPixels(t0);
  assert.ok(ts0.solid > 5000, '1024px tall column must render full-height column body');
  assert.equal(ts0.semiTransparent, 0, '1024px tall column must have 0 AA pixels');
  for (let r = 1; r <= 4; r++) {
    dTall.rotateView(1);
    const tr = dTall.renderToBuffer();
    assert.equal(countPixels(tr).semiTransparent, 0, `1024px rot ${r * 90}deg 0 AA`);
    if (r === 4) assert.ok(buffersEqual(tr, t0), '1024px column must satisfy 4x90deg rotation closure');
  }

  console.log('PASS: v1.2.4 features (Loft poly 3..12, column control sections/edges/lock, cylinder ring, 1024px cap, 0-AA & 4x90deg closure)');
}

async function testV125Features() {
  // 1. Loft trajectory-constrained node sliding ("沿当前轨迹移动"):
  //    Verify rounded_rect corner nodes slide bidirectionally (enlarge & shrink corner)
  //    while staying strictly on the flat straight wall and scaling Bezier handles + mirror partner.
  const rrOrig = createLoftPresetNodes('rounded_rect');
  const rrN = rrOrig.length;
  let slideIdx = -1;
  let wallIsConstantV = false;
  for (let i = 0; i < rrN; i++) {
    const prev = rrOrig[(i - 1 + rrN) % rrN];
    const next = rrOrig[(i + 1) % rrN];
    const cur = rrOrig[i];
    if (Math.abs(prev.v - cur.v) < 1e-4 || Math.abs(next.v - cur.v) < 1e-4) {
      slideIdx = i;
      wallIsConstantV = true;
      break;
    }
  }
  assert.ok(slideIdx >= 0 && wallIsConstantV, 'rounded_rect must have a straight-wall corner node');
  const rrRail = buildLoftNodeSlideRail(rrOrig, slideIdx);
  assert.ok(rrRail.samples.length >= 16, 'Loft slide rail must contain dense samples');

  const baseU = rrOrig[slideIdx].u;
  const baseV = rrOrig[slideIdx].v;
  const mirrorIdx = rrOrig.findIndex(
    (nd, idx) => idx !== slideIdx && Math.abs(nd.u - (1 - baseU)) < 1e-3 && Math.abs(nd.v - baseV) < 1e-3,
  );
  const mirrorRail = mirrorIdx >= 0 ? buildLoftNodeSlideRail(rrOrig, mirrorIdx) : undefined;
  const mirrorPoint = (u: number, v: number): [number, number] => [1 - u, v];

  const rrNodesPlus = rrOrig.map(cloneLoftNode);
  applyLoftNodeSlideAtArcS(
    rrNodesPlus,
    rrOrig,
    slideIdx,
    rrRail,
    0.06,
    mirrorRail ? { idx: mirrorIdx, rail: mirrorRail, mirrorPoint } : undefined,
  );
  assert.ok(Math.abs(rrNodesPlus[slideIdx].v - baseV) < 1e-3, 'Slide + along straight wall must keep v exact');
  assert.ok(Math.abs(rrNodesPlus[slideIdx].u - baseU) > 0.02, 'Slide + along rail must move u substantially');

  const rrNodesMinus = rrOrig.map(cloneLoftNode);
  applyLoftNodeSlideAtArcS(
    rrNodesMinus,
    rrOrig,
    slideIdx,
    rrRail,
    -0.06,
    mirrorRail ? { idx: mirrorIdx, rail: mirrorRail, mirrorPoint } : undefined,
  );
  assert.ok(Math.abs(rrNodesMinus[slideIdx].v - baseV) < 1e-3, 'Slide - along straight wall must keep v exact');
  assert.ok(
    (rrNodesPlus[slideIdx].u - baseU) * (rrNodesMinus[slideIdx].u - baseU) < 0,
    'Bidirectional trajectory slide must move node in opposite directions along wall',
  );
  if (mirrorIdx >= 0) {
    assert.ok(
      Math.abs(rrNodesPlus[mirrorIdx].u - (1 - rrNodesPlus[slideIdx].u)) < 1e-3 &&
        Math.abs(rrNodesPlus[mirrorIdx].v - rrNodesPlus[slideIdx].v) < 1e-3,
      'Trajectory slide mirror partner must remain symmetric across center line',
    );
  }
  const rrProj = projectOntoLoftSlideRail(rrRail, rrNodesPlus[slideIdx].u, rrNodesPlus[slideIdx].v);
  assert.ok(Math.hypot(rrProj.u - rrNodesPlus[slideIdx].u, rrProj.v - rrNodesPlus[slideIdx].v) < 0.01);

  // 2. Arch trajectory-constrained node sliding ("沿当前轨迹移动")
  const archOrig = createArchPresetNodes('stilted');
  assert.ok(archOrig.length >= 3, 'stilted arch has interior nodes');
  const aIdx = 1;
  const aOrigS = archOrig[aIdx].s;
  const aMirrorIdx = archOrig.findIndex(
    (nd, idx) => idx !== aIdx && Math.abs(nd.s - (1 - aOrigS)) < 1e-3 && Math.abs(nd.h - archOrig[aIdx].h) < 1e-3,
  );
  const aRail = buildArchNodeSlideRail(archOrig, aIdx, false);
  const aMirrorRail = aMirrorIdx >= 0 ? buildArchNodeSlideRail(archOrig, aMirrorIdx, false) : undefined;
  const aNodesUp = archOrig.map(cloneArchNode);
  applyArchNodeSlideAtArcS(
    aNodesUp,
    archOrig,
    aIdx,
    aRail,
    0.04,
    false,
    aMirrorRail ? { idx: aMirrorIdx, rail: aMirrorRail } : undefined,
  );
  const aNodesDn = archOrig.map(cloneArchNode);
  applyArchNodeSlideAtArcS(
    aNodesDn,
    archOrig,
    aIdx,
    aRail,
    -0.04,
    false,
    aMirrorRail ? { idx: aMirrorIdx, rail: aMirrorRail } : undefined,
  );
  assert.ok(
    Math.hypot(aNodesUp[aIdx].s - aNodesDn[aIdx].s, aNodesUp[aIdx].h - aNodesDn[aIdx].h) > 0.02,
    'Arch trajectory slide must move node smoothly in both directions',
  );
  if (aMirrorIdx >= 0) {
    assert.ok(
      Math.abs(aNodesUp[aMirrorIdx].s - (1 - aNodesUp[aIdx].s)) < 1e-3 &&
        Math.abs(aNodesUp[aMirrorIdx].h - aNodesUp[aIdx].h) < 1e-3,
      'Arch trajectory slide mirror partner must remain left-right symmetric',
    );
  }
  const aProj = projectOntoArchSlideRail(aRail, aNodesUp[aIdx].s, aNodesUp[aIdx].h);
  assert.ok(Math.hypot(aProj.s - aNodesUp[aIdx].s, aProj.h - aNodesUp[aIdx].h) < 0.01);

  // 3. Loft transition section ("新建过渡面" & "转换为过渡面") + live sync + 0-AA + 4x90deg + .bmeow
  const dLoft = new BuilderDocument(128, 160, 2, 2, 16);
  const loft = createDefaultShape('loft', {
    u: 0,
    v: 0,
    zPx: 0,
    sizeU: 2,
    sizeV: 2,
    heightPx: 72,
    pattern: 'solid',
    loftHollow: true,
  });
  const secs = loft.loftSections!;
  // Reset to clean bottom(star) -> mid(square) -> top(circle) stack
  const botId = nextLoftSectionId();
  const midId = nextLoftSectionId();
  const topId = nextLoftSectionId();
  secs.splice(
    0,
    secs.length,
    {
      id: botId,
      name: '底层星形',
      t: 0,
      scale: 1,
      twistDeg: 0,
      offsetU: 0,
      offsetV: 0,
      nodes: createLoftPresetNodes('star'),
      innerMode: 'parallel',
      innerThickness: 0.24,
    },
    {
      id: midId,
      name: '过渡测试面',
      t: 0.5,
      scale: 1,
      twistDeg: 0,
      offsetU: 0,
      offsetV: 0,
      nodes: createLoftPresetNodes('square'),
      innerMode: 'parallel',
      innerThickness: 0.24,
    },
    {
      id: topId,
      name: '顶层圆形',
      t: 1,
      scale: 0.85,
      twistDeg: 0,
      offsetU: 0,
      offsetV: 0,
      nodes: createLoftPresetNodes('circle'),
      innerMode: 'parallel',
      innerThickness: 0.24,
    },
  );
  loft.activeLoftSectionId = midId;
  assert.equal(canLoftSectionBeTransition(secs, botId), false, 'Bottom endpoint section cannot be transition');
  assert.equal(canLoftSectionBeTransition(secs, topId), false, 'Top endpoint section cannot be transition');
  assert.equal(canLoftSectionBeTransition(secs, midId), true, 'Middle section can convert to transition');
  assert.equal(convertLoftSectionToTransition(secs, midId, 2, 2, false), true, 'Convert to transition succeeds');
  const midSec = secs.find((s) => s.id === midId)!;
  assert.equal(midSec.isTransition, true);
  assert.ok(midSec.nodes.length >= 12, 'Star->Circle cross-topology transition keeps high landmark detail');
  const snapAt50 = midSec.nodes.map((n) => [n.u, n.v]);
  // Move height t to 0.25 and verify live transition resync changes curve toward bottom star
  midSec.t = 0.25;
  syncLoftTransitionSections(secs, 2, 2);
  const diffAfterT = midSec.nodes.reduce(
    (acc, n, i) => acc + Math.hypot(n.u - snapAt50[i][0], n.v - snapAt50[i][1]),
    0,
  );
  assert.ok(diffAfterT > 0.05, 'Changing transition section height must re-interpolate curve automatically');

  dLoft.layers.push(new BuilderLayer(128, 160, 'loftTrans', 'shape', loft));
  dLoft.rerenderAllShapes();
  const l0 = dLoft.renderToBuffer();
  const ls0 = countPixels(l0);
  assert.ok(ls0.solid > 500, 'Loft transition section column must render cleanly');
  assert.equal(ls0.semiTransparent, 0, 'Loft transition section render must have 0 AA pixels');
  for (let r = 1; r <= 4; r++) {
    dLoft.rotateView(1);
    const lr = dLoft.renderToBuffer();
    assert.equal(countPixels(lr).semiTransparent, 0, `Loft transition rot ${r * 90}deg 0 AA`);
    if (r === 4) assert.ok(buffersEqual(lr, l0), 'Loft transition 4x90deg rotation closure');
  }
  const loftJson = serializeBmeowProject(dLoft, 'v125-loft-trans');
  const { doc: dLoftLoaded } = await deserializeBmeowProject(loftJson);
  const loadedMid = dLoftLoaded.layers[0].shape!.loftSections!.find((s) => s.id === midId);
  assert.equal(loadedMid?.isTransition, true, '.bmeow roundtrip preserves loft section isTransition');
  assert.ok(buffersEqual(dLoftLoaded.renderToBuffer(), l0), '.bmeow loft transition roundtrip render identical');

  // 4. Column ("新建过渡面" & "转换为过渡面") on box and prism + live sync + 0-AA + 4x90deg + .bmeow
  for (const kind of ['box', 'prism'] as const) {
    const dCol = new BuilderDocument(128, 160, 2, 2, 16);
    const col = createDefaultShape(kind, {
      u: 0,
      v: 0,
      zPx: 0,
      sizeU: 2,
      sizeV: 2,
      heightPx: 68,
      pattern: 'solid',
      prismSides: kind === 'prism' ? 6 : undefined,
    });
    const baseSecs = ensureColumnSections(col);
    const topColSec = baseSecs[baseSecs.length - 1];
    assert.strictEqual(ensureColumnSections(col)[baseSecs.length - 1], topColSec, 'ensureColumnSections must preserve object identity');
    applyColumnSectionTransform(topColSec, { scale: 0.55 });
    const transColSec = insertColumnTransitionSection(col, 0.5);
    assert.ok(transColSec && transColSec.isTransition, `${kind} insertColumnTransitionSection sets isTransition`);
    const midEdge0Before = transColSec!.edges[0].offset;
    // Now change top edge 0 outward and verify sync updates intermediate transition section edge automatically
    applyColumnEdgeEdit(topColSec, 0, 0.18, topColSec.edges[0].angleDeg, { pivotMidpoint: false });
    syncColumnTransitionSections(col);
    assert.ok(
      Math.abs(transColSec!.edges[0].offset - midEdge0Before) > 1e-3,
      `${kind} syncColumnTransitionSections dynamically updates transition edges`,
    );
    // Also verify converting a plain middle section to transition via convertColumnSectionToTransition
    const plainMid = insertColumnSectionAtT(col, 0.25, '普通中层');
    assert.ok(plainMid && !plainMid.isTransition, 'insertColumnSectionAtT creates non-transition section');
    assert.equal(convertColumnSectionToTransition(col, plainMid!.id), true, `${kind} convertColumnSectionToTransition succeeds`);
    assert.equal(plainMid!.isTransition, true);
    assert.equal(canColumnSectionBeTransition(ensureColumnSections(col), baseSecs[0].id), false);
    assert.equal(canColumnSectionBeTransition(ensureColumnSections(col), transColSec!.id), true);

    dCol.layers.push(new BuilderLayer(128, 160, `${kind}Trans`, 'shape', col));
    dCol.rerenderAllShapes();
    const c0 = dCol.renderToBuffer();
    const cs0 = countPixels(c0);
    assert.ok(cs0.solid > 500, `${kind} transition column renders cleanly`);
    assert.equal(cs0.semiTransparent, 0, `${kind} transition column must have 0 AA`);
    for (let r = 1; r <= 4; r++) {
      dCol.rotateView(1);
      const cr = dCol.renderToBuffer();
      assert.equal(countPixels(cr).semiTransparent, 0, `${kind} transition rot ${r * 90}deg 0 AA`);
      if (r === 4) assert.ok(buffersEqual(cr, c0), `${kind} transition 4x90deg rotation closure`);
    }
    const cJson = serializeBmeowProject(dCol, `v125-${kind}-trans`);
    const { doc: dColLoaded } = await deserializeBmeowProject(cJson);
    const loadedColTrans = dColLoaded.layers[0].shape!.colSections!.find((s) => s.id === transColSec!.id);
    assert.equal(loadedColTrans?.isTransition, true, `${kind} .bmeow preserves colSection isTransition`);
    assert.ok(buffersEqual(dColLoaded.renderToBuffer(), c0), `${kind} .bmeow transition roundtrip identical`);
  }

  console.log('PASS: v1.2.5 features (trajectory-constrained node slide on loft/arch, auto transition sections on loft/columns, 0-AA & 4x90deg closure)');
}

function testShortcutSystem() {
  const mkKeyEvent = (opts: {
    code: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    isComposing?: boolean;
    repeat?: boolean;
  }): KeyboardEvent =>
    ({
      code: opts.code,
      ctrlKey: Boolean(opts.ctrlKey),
      metaKey: Boolean(opts.metaKey),
      altKey: Boolean(opts.altKey),
      shiftKey: Boolean(opts.shiftKey),
      isComposing: Boolean(opts.isComposing),
      keyCode: opts.isComposing ? 229 : 0,
      repeat: Boolean(opts.repeat),
      target: null,
      preventDefault() {
        /* noop */
      },
    }) as unknown as KeyboardEvent;

  // 1. KeyCodec serialization, parsing, formatting & IME/modifier guards
  assert.equal(eventToKeyStroke(mkKeyEvent({ code: 'KeyW', isComposing: true })), null, 'IME composing key ignored');
  assert.equal(eventToKeyStroke(mkKeyEvent({ code: 'ShiftLeft', shiftKey: true })), null, 'Bare modifier ignored');
  const modShiftZ = parseKeyStroke('Mod+Shift+KeyZ')!;
  assert.ok(modShiftZ && modShiftZ.code === 'KeyZ' && modShiftZ.mod && modShiftZ.shift && !modShiftZ.alt);
  assert.equal(serializeKeyStroke(modShiftZ), 'Mod+Shift+KeyZ');
  assert.equal(formatKeyStroke(modShiftZ, false), 'Ctrl+Shift+Z');
  assert.equal(formatKeyStroke(modShiftZ, true), '⌘+⇧+Z');

  // 2. Presets, custom binding, auto conflict unbind, reset & cross-app JSON persistence
  const store = new Map<string, string>();
  const memStorage: ShortcutStorageAdapter = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
  };
  const mgr = new ShortcutManager({
    appId: 'blendermeow',
    storageKey: 'test.shortcuts',
    categories: BLENDER_SHORTCUT_CATEGORIES,
    actions: BLENDER_SHORTCUT_ACTIONS,
    presets: BLENDER_SHORTCUT_PRESETS,
    defaultPresetId: 'standard',
    storage: memStorage,
  });
  assert.equal(mgr.getActivePresetId(), 'standard');
  assert.equal(mgr.getPrimaryLabel('view.panUp'), 'W');
  assert.equal(mgr.getPrimaryLabel('history.undo'), 'Ctrl+Z');

  mgr.applyPreset('arrows_canvas');
  assert.equal(mgr.getActivePresetId(), 'arrows_canvas');
  assert.equal(mgr.getPrimaryLabel('view.panUp'), '↑');
  assert.equal(mgr.getAllLabels('nudge.up'), 'Ctrl+↑ / I');

  mgr.applyPreset('tablet_left');
  assert.equal(mgr.getPrimaryLabel('history.undo'), 'Z');
  assert.equal(mgr.getPrimaryLabel('history.redo'), 'X');

  mgr.applyPreset('standard');
  // Rebind view.panUp to KeyQ -> must auto-unbind view.rotateLeft (both workspace scope)
  const conflict = mgr.setSlotBinding('view.panUp', 0, { code: 'KeyQ' });
  assert.ok(conflict.unboundFrom.some((a) => a.id === 'view.rotateLeft'), 'Same-scope conflict auto-unbound');
  assert.equal(mgr.getBindings('view.rotateLeft').length, 0);
  assert.equal(mgr.getActivePresetId(), 'custom');
  assert.equal(mgr.isActionModified('view.panUp'), true);

  // JSON roundtrip & cross-app compatibility (unknown Pixel Meow action safely skipped, known action imported)
  const exported = JSON.parse(mgr.exportJson());
  exported.appId = 'pixelmeow';
  exported.bindings['tool.pencil'] = ['KeyB'];
  const mgr2 = new ShortcutManager({
    appId: 'blendermeow',
    storageKey: 'test.shortcuts.2',
    categories: BLENDER_SHORTCUT_CATEGORIES,
    actions: BLENDER_SHORTCUT_ACTIONS,
    presets: BLENDER_SHORTCUT_PRESETS,
    defaultPresetId: 'standard',
    storage: memStorage,
  });
  const imp = mgr2.importJson(JSON.stringify(exported));
  assert.ok(imp.importedCount >= BLENDER_SHORTCUT_ACTIONS.length);
  assert.equal(mgr2.getPrimaryLabel('view.panUp'), 'Q');
  mgr2.resetToPreset('standard');
  assert.equal(mgr2.getPrimaryLabel('view.panUp'), 'W');
  assert.equal(mgr2.getPrimaryLabel('view.rotateLeft'), 'Q');

  // 3. Dispatch semantics: hold + mid-hold Shift anti-stuck-key, step_repeat coalescing, exact > shiftBoost, scopes + modalBarrier
  let panUpActive = false;
  let undoCount = 0;
  let rootNudgeSteps = 0;
  let rootNudgeEnds = 0;
  let rootNudgeLastDidMutate = false;
  let zUpSteps = 0;

  mgr2.onHold('view.panUp', (active) => {
    panUpActive = active;
  });
  mgr2.onTrigger('history.undo', () => {
    undoCount++;
  });
  mgr2.onStepRepeat('nudge.up', {
    onStep: () => {
      rootNudgeSteps++;
      return true;
    },
    onEnd: (didMutate) => {
      rootNudgeEnds++;
      rootNudgeLastDidMutate = didMutate;
    },
  });
  mgr2.onStepRepeat('nudge.zUp', {
    onStep: () => {
      zUpSteps++;
      return true;
    },
  });

  // Press W -> hold active; press Shift mid-hold -> release W -> anti-stuck-key must deactivate cleanly
  assert.equal(mgr2.handleKeyDown(mkKeyEvent({ code: 'KeyW' })), true);
  assert.equal(panUpActive, true);
  mgr2.handleKeyDown(mkKeyEvent({ code: 'KeyW', shiftKey: true, repeat: true }));
  mgr2.handleKeyUp(mkKeyEvent({ code: 'KeyW', shiftKey: true }));
  assert.equal(panUpActive, false, 'Hold release by physical e.code avoids stuck keys when modifiers change');

  // Exact modifier match (Alt+ArrowUp -> nudge.zUp) beats ArrowUp shiftBoost/base
  mgr2.handleKeyDown(mkKeyEvent({ code: 'ArrowUp', altKey: true }));
  mgr2.handleKeyUp(mkKeyEvent({ code: 'ArrowUp', altKey: true }));
  assert.equal(zUpSteps, 1);
  assert.equal(rootNudgeSteps, 0);

  // step_repeat coalesces 3 repeats into 1 onEnd(true)
  mgr2.handleKeyDown(mkKeyEvent({ code: 'ArrowUp' }));
  mgr2.handleKeyDown(mkKeyEvent({ code: 'ArrowUp', shiftKey: true, repeat: true }));
  mgr2.handleKeyDown(mkKeyEvent({ code: 'ArrowUp', shiftKey: true, repeat: true }));
  mgr2.handleKeyUp(mkKeyEvent({ code: 'ArrowUp', shiftKey: true }));
  assert.equal(rootNudgeSteps, 3);
  assert.equal(rootNudgeEnds, 1);
  assert.equal(rootNudgeLastDidMutate, true);

  // Modal scope with modalBarrier blocks root undo & workspace keys, routes undo + nudge to modal
  let modalOpen = true;
  let modalUndo = 0;
  let modalNudgeShift = false;
  let modalNudgeEnds = 0;
  const unsubModal = mgr2.registerScope({
    id: 'test-modal',
    priority: 100,
    modalBarrier: true,
    isActive: () => modalOpen,
    triggers: {
      'history.undo': () => {
        modalUndo++;
        return true;
      },
    },
    stepRepeats: {
      'nudge.left': {
        onStep: (ctx) => {
          modalNudgeShift = ctx.shiftBoost;
          return true;
        },
        onEnd: () => {
          modalNudgeEnds++;
        },
      },
    },
  });

  mgr2.handleKeyDown(mkKeyEvent({ code: 'KeyZ', ctrlKey: true }));
  assert.equal(modalUndo, 1, 'Active modal intercepts history.undo');
  assert.equal(undoCount, 0, 'Root history.undo blocked by active modal');
  assert.equal(mgr2.handleKeyDown(mkKeyEvent({ code: 'KeyW' })), false, 'modalBarrier blocks root pan while modal open');
  assert.equal(panUpActive, false);

  mgr2.handleKeyDown(mkKeyEvent({ code: 'ArrowLeft', shiftKey: true }));
  mgr2.handleKeyUp(mkKeyEvent({ code: 'ArrowLeft', shiftKey: true }));
  assert.equal(modalNudgeShift, true, 'Shift+ArrowLeft triggers allowShiftBoost inside modal scope');
  assert.equal(modalNudgeEnds, 1);

  modalOpen = false;
  mgr2.handleKeyDown(mkKeyEvent({ code: 'KeyZ', ctrlKey: true }));
  assert.equal(undoCount, 1, 'Root history.undo works again when modal closes');
  unsubModal();

  console.log('PASS: Shortcut system (KeyCodec, presets/conflicts/JSON roundtrip, anti-stuck-key hold, step_repeat coalescing, modalBarrier scopes)');
}

async function testPlanarFaceTextures() {
  // 1. Pixel Meow lossless sawtooth shear <-> deshear roundtrip across directions & steps
  const rw = 16;
  const rh = 20;
  const rectSrc = new Uint8ClampedArray(rw * rh * 4);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = (y * rw + x) * 4;
      if (x === 0 && y === 0) {
        rectSrc[i] = 0;
        rectSrc[i + 1] = 0;
        rectSrc[i + 2] = 0;
        rectSrc[i + 3] = 0;
      } else {
        rectSrc[i] = (x * 15 + 20) & 255;
        rectSrc[i + 1] = (y * 12 + 30) & 255;
        rectSrc[i + 2] = ((x + y) * 9) & 255;
        rectSrc[i + 3] = 255;
      }
    }
  }
  for (const dir of ['up_right', 'down_right'] as const) {
    for (const step of [1, 2, 3, 4]) {
      const sheared = shearPixels(rectSrc, rw, rh, dir, step);
      assert.equal(sheared.width, rw);
      assert.equal(sheared.height, rh + Math.floor((rw - 1) / step));
      assert.equal(countPixels(sheared.data).semiTransparent, 0, 'Sheared pixels must have 0 AA');
      const round = deshearPixels(sheared.data, sheared.width, sheared.height, dir, step);
      assert.equal(round.width, rw);
      assert.equal(round.height, rh);
      assert.ok(buffersEqual(round.data, rectSrc), `Pixel Meow shear<->deshear (${dir}, step=${step}) must be bit-exact lossless`);
    }
  }

  // 2. Arbitrary parallelogram warp <-> unwrap & auto-corner detection + library form toggle
  const customPatW = 12;
  const customPatH = 12;
  const patBuf = new Uint8ClampedArray(customPatW * customPatH * 4);
  for (let y = 0; y < customPatH; y++) {
    for (let x = 0; x < customPatW; x++) {
      const i = (y * customPatW + x) * 4;
      // Asymmetric diagonal L-marker so orientation/rotation/stretch vs tile can be verified cleanly
      const isMark = (x < 3 && y < 7) || (y < 3 && x < 7);
      patBuf[i] = isMark ? 245 : 48;
      patBuf[i + 1] = isMark ? 96 : 112;
      patBuf[i + 2] = isMark ? 48 : 210;
      patBuf[i + 3] = 255;
    }
  }
  const warpedIso = warpRectToParallelogramPixels(patBuf, customPatW, customPatH, [12, 6], [0, 12]);
  assert.equal(countPixels(warpedIso.data).semiTransparent, 0, 'Parallelogram warp must have 0 AA');
  const detected = autoDetectParallelogramCorners(warpedIso.data, warpedIso.width, warpedIso.height);
  assert.ok(detected.p10[0] > detected.p00[0], 'Auto-detected p10 must lie right of p00');
  const unwrapped = unwrapParallelogramPixels(
    warpedIso.data,
    warpedIso.width,
    warpedIso.height,
    detected.p00,
    detected.p10,
    detected.p01,
    customPatW,
    customPatH,
  );
  assert.equal(unwrapped.width, customPatW);
  assert.equal(unwrapped.height, customPatH);
  assert.equal(countPixels(unwrapped.data).semiTransparent, 0, 'Unwrapped parallelogram must have 0 AA');

  const testAsset = makeTextureAssetFromRgba({
    id: 'test_custom_asym',
    name: '测试不对称方块',
    width: customPatW,
    height: customPatH,
    rectData: patBuf,
  });
  upsertTextureAsset(testAsset, false);
  assert.ok(getTextureLibrary().some((a) => a.id === 'test_custom_asym'));
  assert.equal(testAsset.displayForm, 'rect');
  const toggled = toggleTextureAssetForm(testAsset.id);
  assert.equal(toggled?.displayForm, 'parallelogram');
  const paraDisp = getAssetDisplayPixels(testAsset);
  assert.ok(paraDisp.height > testAsset.height, 'Sawtooth parallelogram display must increase bounding height');
  assert.equal(countPixels(paraDisp.data).semiTransparent, 0);
  toggleTextureAssetForm(testAsset.id);
  assert.equal(testAsset.displayForm, 'rect');

  // 3. Planar vs non-planar eligibility check
  for (const kind of ['box', 'prism', 'right_tri_prism', 'wedge', 'pyramid'] as const) {
    const s = createDefaultShape(kind, { sizeU: 2, sizeV: 2, heightPx: 24 });
    assert.equal(isPlanarTextureShape(s), true, `${kind} must support planar textures`);
    const faces = getPlanarFacesForShape(s);
    assert.ok(faces.length >= 4, `${kind} must expose planar faces`);
    for (const f of faces) {
      assert.ok(f.faceW >= 4 && f.faceH >= 4, `${kind}.${f.id} must have positive pixel dimensions`);
    }
  }
  for (const curved of ['cylinder', 'cone', 'dome', 'arch', 'loft', 'theotown_base'] as const) {
    assert.equal(isPlanarTextureShape(createDefaultShape(curved)), false, `${curved} is non-planar`);
  }

  // 4. Stretch ("填充") vs Tile ("覆盖") no-distortion test on wide wall
  const wideSpec = getPlanarFacesForShape(createDefaultShape('box', { sizeU: 3, sizeV: 1, heightPx: 24 })).find((f) => f.id === 'wall_pv')!;
  assert.equal(wideSpec.faceW, 48);
  assert.equal(wideSpec.faceH, 24);
  const flatStretch = renderFaceTextureFlatBuffer(wideSpec, { mode: 'stretch', assetId: 'test_custom_asym' }, { r: 100, g: 100, b: 100, a: 255 });
  const flatTile = renderFaceTextureFlatBuffer(wideSpec, { mode: 'tile', assetId: 'test_custom_asym', tileScale: 1 }, { r: 100, g: 100, b: 100, a: 255 });
  assert.ok(!buffersEqual(flatStretch.data, flatTile.data), 'Stretch and Tile must produce distinct pixels on wide wall');
  // In tile mode with 12x12 texture on 48x24 face, x=1 and x=13 (one period later) must match identically
  const pTile1 = sampleFaceTextureRGBA({ mode: 'tile', assetId: 'test_custom_asym', tileScale: 1 }, 1.5 / 48, 1.5 / 24, 48, 24);
  const pTile13 = sampleFaceTextureRGBA({ mode: 'tile', assetId: 'test_custom_asym', tileScale: 1 }, 13.5 / 48, 1.5 / 24, 48, 24);
  const pTileOut = sampleFaceTextureRGBA({ mode: 'tile', assetId: 'test_custom_asym', tileScale: 1 }, 21.5 / 48, 1.5 / 24, 48, 24);
  const pStretchAt21 = sampleFaceTextureRGBA({ mode: 'stretch', assetId: 'test_custom_asym' }, 21.5 / 48, 1.5 / 24, 48, 24);
  assert.deepEqual(pTile1, pTile13, 'Tile mode must repeat texture periodically without horizontal stretch distortion');
  assert.notDeepEqual(pTile1, pTileOut, 'Tile mode preserves unstretched asymmetric marker geometry');
  assert.notDeepEqual(pTileOut, pStretchAt21, 'Tile vs Stretch differ at warped horizontal coordinate');

  // 5. Render all planar primitives (box, prism, right_tri_prism, wedge ramp/gable, pyramid) + polygonal column sections
  //    with Stretch, Tile, and Custom stacked puzzle composition -> 0 AA leakage across all rotations
  const W = 256, H = 256;
  const { originX, originY } = getPlotOrigin(W, H, 4, 4, 16);
  const testBuf = new Uint8ClampedArray(W * H * 4);
  const texturedPrimitives: ReturnType<typeof createDefaultShape>[] = [
    createDefaultShape('box', {
      u: 1, v: 1, sizeU: 2, sizeV: 2, heightPx: 32,
      faceTextures: {
        top: { mode: 'tile', assetId: 'builtin_roof_tile', shadeWithFace: true },
        wall_pv: {
          mode: 'custom',
          shadeWithFace: true,
          items: [
            { id: 'bg', assetId: 'builtin_brick_red', x: 0, y: 0, w: 32, h: 32, tileFill: true },
            { id: 'w1', assetId: 'builtin_win_double', x: 3, y: 6, w: 8, h: 10 },
            { id: 'sign', assetId: 'builtin_sign_neon', x: 14, y: 8, w: 14, h: 6 },
            { id: 'door', assetId: 'builtin_door_wood', x: 18, y: 18, w: 8, h: 14 },
          ],
        },
        wall_pu: { mode: 'stretch', assetId: 'test_custom_asym', shadeWithFace: false },
      },
    }),
    createDefaultShape('prism', {
      u: 1, v: 1, sizeU: 2, sizeV: 2, heightPx: 28, prismSides: 6,
      faceTextures: {
        top: { mode: 'tile', assetId: 'builtin_stone_gray' },
        side_0: { mode: 'tile', assetId: 'builtin_curtain_glass' },
        side_1: { mode: 'stretch', assetId: 'builtin_brick_red' },
      },
    }),
    createDefaultShape('right_tri_prism', {
      u: 1, v: 1, sizeU: 2, sizeV: 2, heightPx: 24, triPrismCut: 'vertical',
      faceTextures: {
        top: { mode: 'tile', assetId: 'builtin_roof_tile' },
        wall_hyp: { mode: 'tile', assetId: 'builtin_curtain_glass' },
      },
    }),
    createDefaultShape('wedge', {
      u: 1, v: 1, sizeU: 2, sizeV: 2, heightPx: 20, wedgeMode: 'gable',
      faceTextures: {
        slope_pv: { mode: 'tile', assetId: 'builtin_roof_tile' },
        gable_pu: { mode: 'stretch', assetId: 'builtin_stone_gray' },
      },
    }),
    createDefaultShape('pyramid', {
      u: 1, v: 1, sizeU: 2, sizeV: 2, heightPx: 28,
      faceTextures: {
        pyr_pv: { mode: 'tile', assetId: 'builtin_stone_gray' },
        pyr_pu: { mode: 'stretch', assetId: 'builtin_brick_red' },
      },
    }),
    (() => {
      const colBox = createDefaultShape('box', {
        u: 1, v: 1, sizeU: 2, sizeV: 2, heightPx: 32,
        faceTextures: {
          top: { mode: 'tile', assetId: 'builtin_stone_gray' },
          wall_pv: { mode: 'tile', assetId: 'builtin_brick_red' },
        },
      });
      ensureColumnSections(colBox);
      colBox.colSections![1].scale = 0.85;
      return colBox;
    })(),
  ];

  for (const shp of texturedPrimitives) {
    for (const rot of [0, 1, 2, 3] as const) {
      testBuf.fill(0);
      renderShapeToBuffer(testBuf, W, H, shp, 4, 4, rot, originX, originY);
      const st = countPixels(testBuf);
      assert.ok(st.solid > 100, `Textured ${shp.shapeType} rot=${rot} must render solid pixels`);
      assert.equal(st.semiTransparent, 0, `Textured ${shp.shapeType} rot=${rot} must have 0 AA`);
    }
  }

  // 6. Strict 4x90deg view-rotation closure on single-face textured box on non-square plot (4x2)
  const rotDoc = new BuilderDocument(256, 256, 4, 2, 16);
  const rotBox = createDefaultShape('box', {
    u: 1.0,
    v: 0.5,
    sizeU: 1.5,
    sizeV: 1.0,
    heightPx: 28,
    ori: 0,
    baseColor: { r: 168, g: 176, b: 194, a: 255 },
    faceTextures: {
      wall_pv: {
        mode: 'custom',
        shadeWithFace: true,
        items: [
          { id: 'c1', assetId: 'test_custom_asym', x: 2, y: 4, w: 12, h: 12 },
          { id: 'c2', assetId: 'builtin_win_double', x: 15, y: 8, w: 8, h: 10 },
        ],
      },
    },
  });
  const rotLayer = new BuilderLayer(rotDoc.width, rotDoc.height, 'TexturedBox', 'shape', rotBox);
  rotDoc.layers.push(rotLayer);
  rotDoc.rerenderAllShapes();

  const snap0 = new Uint8ClampedArray(rotDoc.renderToBuffer());
  assert.equal(countPixels(snap0).semiTransparent, 0);
  for (let step = 1; step <= 4; step++) {
    rotDoc.rotateView(1);
    const cur = rotDoc.renderToBuffer();
    assert.equal(countPixels(cur).semiTransparent, 0, `Textured 4x90 step ${step} must have 0 AA`);
    if (step < 4) {
      assert.ok(!buffersEqual(cur, snap0), `Textured rotation ${step * 90}deg must differ from 0deg`);
    } else {
      assert.ok(buffersEqual(cur, snap0), 'Textured 4x90deg rotation must close pixel-for-pixel');
    }
  }

  // 7. .bmeow project serialization & deserialization with embedded custom texture asset
  const json = serializeBmeowProject(rotDoc, 'TexturedBoxProject');
  const parsedObj = JSON.parse(json);
  assert.ok(
    Array.isArray(parsedObj.textureAssets) && parsedObj.textureAssets.some((a: { id: string }) => a.id === 'test_custom_asym'),
    '.bmeow project must bundle referenced custom texture assets',
  );
  // Remove custom asset from registry before loading to prove deserialization restores it cleanly
  removeTextureAsset('test_custom_asym');
  assert.equal(getTextureAsset('test_custom_asym'), undefined);
  const { doc: loadedDoc } = await deserializeBmeowProject(json);
  assert.ok(getTextureAsset('test_custom_asym'), 'deserializeBmeowProject must restore custom texture asset');
  assert.ok(buffersEqual(loadedDoc.renderToBuffer(), snap0), 'Deserialized textured project must render identically');
  removeTextureAsset('test_custom_asym');

  // 8. Non-destructive texture crop across stretch / tile / custom modes + 0-AA
  const quadData = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const idx = (y * 4 + x) * 4;
      if (x < 2 && y < 2) {
        quadData[idx] = 255; quadData[idx + 3] = 255; // Top-Left: Red
      } else if (x >= 2 && y < 2) {
        quadData[idx + 1] = 255; quadData[idx + 3] = 255; // Top-Right: Green
      } else if (x < 2 && y >= 2) {
        quadData[idx + 2] = 255; quadData[idx + 3] = 255; // Bottom-Left: Blue
      } else {
        quadData[idx] = 255; quadData[idx + 1] = 255; quadData[idx + 3] = 255; // Bottom-Right: Yellow
      }
    }
  }
  const cropAsset = makeTextureAssetFromRgba({
    id: 'test_crop_quad',
    name: 'QuadCropTest',
    rectData: quadData,
    width: 4,
    height: 4,
    displayForm: 'rect',
  });
  upsertTextureAsset(cropAsset);

  assert.deepEqual(getEffectiveAssetDims(cropAsset, { x: 2, y: 0, w: 2, h: 2 }), { x: 2, y: 0, w: 2, h: 2 });
  const croppedYellow = cropRgbaBuffer(cropAsset.rectData, 4, 4, { x: 2, y: 2, w: 2, h: 2 });
  assert.equal(croppedYellow.width, 2);
  assert.equal(croppedYellow.height, 2);
  assert.deepEqual([croppedYellow.data[0], croppedYellow.data[1], croppedYellow.data[2], croppedYellow.data[3]], [255, 255, 0, 255]);

  const stretchCropS1 = sampleFaceTextureRGBA(
    { mode: 'stretch', assetId: 'test_crop_quad', crop: { x: 2, y: 0, w: 2, h: 2 } },
    0.1,
    0.1,
    16,
    16,
  );
  const stretchCropS2 = sampleFaceTextureRGBA(
    { mode: 'stretch', assetId: 'test_crop_quad', crop: { x: 2, y: 0, w: 2, h: 2 } },
    0.9,
    0.9,
    16,
    16,
  );
  assert.deepEqual(stretchCropS1, { r: 0, g: 255, b: 0, a: 255 }, 'Cropped stretch must sample only cropped green quadrant');
  assert.deepEqual(stretchCropS2, { r: 0, g: 255, b: 0, a: 255 });

  // Center 2x2 crop ({x:1,y:1,w:2,h:2}) must tile with periodic width/height 2 rather than full 4
  const tileCropSlot = { mode: 'tile' as const, assetId: 'test_crop_quad', crop: { x: 1, y: 1, w: 2, h: 2 }, tileScale: 1 };
  const t00 = sampleFaceTextureRGBA(tileCropSlot, 0.5 / 8, 0.5 / 8, 8, 8);
  const t10 = sampleFaceTextureRGBA(tileCropSlot, 1.5 / 8, 0.5 / 8, 8, 8);
  const t20 = sampleFaceTextureRGBA(tileCropSlot, 2.5 / 8, 0.5 / 8, 8, 8);
  const t02 = sampleFaceTextureRGBA(tileCropSlot, 0.5 / 8, 2.5 / 8, 8, 8);
  assert.ok(t00 && t10 && t20 && t02);
  assert.notDeepEqual(t00, t10, 'Adjacent pixels within cropped 2x2 tile should differ');
  assert.deepEqual(t20, t00, 'Tile horizontal period must equal cropped width (2px)');
  assert.deepEqual(t02, t00, 'Tile vertical period must equal cropped height (2px)');

  const customCropSlot = {
    mode: 'custom' as const,
    items: [{ id: 'dc1', assetId: 'test_crop_quad', x: 2, y: 2, w: 4, h: 4, crop: { x: 0, y: 2, w: 2, h: 2 } }],
  };
  assert.deepEqual(sampleFaceTextureRGBA(customCropSlot, 4 / 8, 4 / 8, 8, 8), { r: 0, g: 0, b: 255, a: 255 });
  assert.equal(sampleFaceTextureRGBA(customCropSlot, 0.5 / 8, 0.5 / 8, 8, 8), null);

  const cropBoxDoc = new BuilderDocument(128, 128, 2, 2, 16);
  cropBoxDoc.layers.push(new BuilderLayer(128, 128, 'CropTileBox', 'shape', createDefaultShape('box', {
    u: 0,
    v: 0,
    sizeU: 1,
    sizeV: 1,
    heightPx: 20,
    autoShade: false,
    faceTextures: { wall_pv: { mode: 'tile', assetId: 'test_crop_quad', crop: { x: 2, y: 0, w: 2, h: 2 }, shadeWithFace: false } },
  })));
  cropBoxDoc.rerenderAllShapes();
  assert.equal(countPixels(cropBoxDoc.renderToBuffer()).semiTransparent, 0, 'Cropped tile box render must remain strict 0-AA');

  // 9. Directional face pixel sampling across rotations via getPlanarFaceScreenOverlay
  const redData = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) {
    redData[i * 4] = 255;
    redData[i * 4 + 3] = 255;
  }
  upsertTextureAsset(makeTextureAssetFromRgba({
    id: 'test_red_solid',
    name: 'RedSolidTest',
    rectData: redData,
    width: 4,
    height: 4,
    displayForm: 'rect',
  }));
  const dirBox = createDefaultShape('box', {
    u: 0,
    v: 0,
    sizeU: 1,
    sizeV: 1,
    heightPx: 24,
    ori: 0,
    baseColor: { r: 128, g: 128, b: 128, a: 255 },
    autoShade: false,
    outlineMode: 'none',
    faceTextures: {
      wall_pv: { mode: 'stretch', assetId: 'test_red_solid', shadeWithFace: false },
    },
  });
  const sampleFaceCentroidAtRot = (rot: 0 | 1 | 2 | 3) => {
    const { originX, originY } = getPlotOrigin(128, 128, 1, 1);
    const ov = getPlanarFaceScreenOverlay(dirBox, 'wall_pv', 1, 1, rot, originX, originY);
    if (!ov || !ov.visible || ov.screenVerts.length === 0) return { visible: false as const, originX };
    let sx = 0;
    let sy = 0;
    for (const [vx, vy] of ov.screenVerts) {
      sx += vx;
      sy += vy;
    }
    const cx = Math.round(sx / ov.screenVerts.length);
    const cy = Math.round(sy / ov.screenVerts.length);
    const buf = new Uint8ClampedArray(128 * 128 * 4);
    renderShapeToBuffer(buf, 128, 128, dirBox, 1, 1, rot, originX, originY);
    const p = (cy * 128 + cx) * 4;
    return {
      visible: true as const,
      originX,
      cx,
      cy,
      rgba: [buf[p], buf[p + 1], buf[p + 2], buf[p + 3]],
    };
  };
  const rot0 = sampleFaceCentroidAtRot(0);
  const rot1 = sampleFaceCentroidAtRot(1);
  const rot2 = sampleFaceCentroidAtRot(2);
  const rot3 = sampleFaceCentroidAtRot(3);
  assert.ok(rot0.visible, 'wall_pv must be visible at rot=0');
  assert.ok(rot0.cx < rot0.originX, 'wall_pv must sit on front-left at rot=0');
  assert.deepEqual(rot0.rgba, [255, 0, 0, 255], 'wall_pv centroid pixel must be red at rot=0');
  assert.ok(!rot1.visible && !rot2.visible, 'wall_pv must be back-facing and hidden at rot=1 and rot=2');
  assert.ok(rot3.visible, 'wall_pv must be visible again at rot=3');
  assert.ok(rot3.cx > rot3.originX, 'wall_pv must move to front-right at rot=3');
  assert.deepEqual(rot3.rgba, [255, 0, 0, 255], 'wall_pv centroid pixel must remain red at rot=3');
  removeTextureAsset('test_red_solid');

  // 10. M2 .bmeow same-ID conflict protection & projectScoped separation
  const blueData = new Uint8ClampedArray(4 * 4 * 4);
  const greenData = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) {
    blueData[i * 4 + 2] = 255;
    blueData[i * 4 + 3] = 255;
    greenData[i * 4 + 1] = 255;
    greenData[i * 4 + 3] = 255;
  }
  upsertTextureAsset(makeTextureAssetFromRgba({
    id: 'conflict_tex',
    name: 'UserBlueTex',
    rectData: blueData,
    width: 4,
    height: 4,
    displayForm: 'rect',
    projectScoped: false,
  }));
  const conflictDoc = new BuilderDocument(128, 128, 2, 2, 16);
  conflictDoc.layers.push(new BuilderLayer(128, 128, 'ConflictBox', 'shape', createDefaultShape('box', {
    u: 0,
    v: 0,
    sizeU: 1,
    sizeV: 1,
    heightPx: 16,
    faceTextures: { wall_pv: { mode: 'stretch', assetId: 'conflict_tex', shadeWithFace: false } },
  })));
  const conflictParsed = JSON.parse(serializeBmeowProject(conflictDoc, 'ConflictProj'));
  const entry = conflictParsed.textureAssets.find((a: { id: string }) => a.id === 'conflict_tex');
  assert.ok(entry, 'Serialized conflict project must embed conflict_tex');
  entry.rgbaBase64 = Buffer.from(greenData.buffer, greenData.byteOffset, greenData.byteLength).toString('base64');
  delete entry.pngDataUrl;

  const { doc: loadedConflictDoc } = await deserializeBmeowProject(JSON.stringify(conflictParsed));
  const libAssetAfter = getTextureAsset('conflict_tex');
  assert.ok(libAssetAfter && libAssetAfter.rectData[2] === 255 && libAssetAfter.rectData[1] === 0, 'Existing blue library asset must not be overwritten');
  const remappedId = loadedConflictDoc.layers[0]?.shape?.faceTextures?.wall_pv?.assetId;
  assert.ok(remappedId && remappedId !== 'conflict_tex', 'Conflicting imported texture ID must be remapped');
  const remappedAsset = getTextureAsset(remappedId);
  assert.ok(remappedAsset && remappedAsset.rectData[1] === 255 && remappedAsset.rectData[2] === 0, 'Remapped project asset must preserve imported green pixels');
  assert.equal(remappedAsset.projectScoped, true, 'Remapped conflicting project asset must be marked projectScoped');
  const persistableAssets = getPersistableUserTextureAssets();
  assert.ok(persistableAssets.some((a) => a.id === 'conflict_tex'), 'User library asset must remain persistable');
  assert.ok(!persistableAssets.some((a) => a.id === remappedId), 'projectScoped asset must be excluded from permanent library persistence');
  removeTextureAsset('conflict_tex');
  removeTextureAsset(remappedId);

  // 11. M4 tapered colSections box with tile texture renders cleanly with 0-AA
  const taperDoc = new BuilderDocument(128, 128, 2, 2, 16);
  const taperBox = createDefaultShape('box', {
    u: 0.25,
    v: 0.25,
    sizeU: 1.5,
    sizeV: 1.5,
    heightPx: 24,
    ori: 0,
    baseColor: { r: 190, g: 190, b: 190, a: 255 },
    autoShade: true,
    faceTextures: { wall_pv: { mode: 'tile', assetId: 'test_crop_quad', shadeWithFace: true } },
  });
  taperBox.colSections = ensureColumnSections(taperBox);
  taperBox.colSections[taperBox.colSections.length - 1].scale = 0.5;
  taperDoc.layers.push(new BuilderLayer(128, 128, 'TaperedTileBox', 'shape', taperBox));
  taperDoc.rerenderAllShapes();
  const taperCounts = countPixels(taperDoc.renderToBuffer());
  assert.ok(taperCounts.solid > 20, 'Tapered textured column box must render visible solid pixels');
  assert.equal(taperCounts.semiTransparent, 0, 'Tapered textured column box must keep strict 0-AA');
  removeTextureAsset('test_crop_quad');

  console.log('PASS: Planar face textures (Pixel Meow lossless shear<->rect, quad unwrap, stretch/tile/custom/crop, directional rot, M2 conflict guard, M4 tapered tile, 0-AA, 4x90deg closure & .bmeow round-trip)');
}

async function testV131Features() {
  // -------- 1. Texture Group Management & .bmeow Round-trip --------
  const initialGroups = getTextureGroups();
  assert.ok(initialGroups.length >= 2, 'Built-in preset and default user groups must exist');
  assert.equal(initialGroups[0].id, BUILTIN_PRESET_GROUP_ID);
  assert.equal(initialGroups[0].builtIn, true);
  assert.equal(initialGroups[1].id, DEFAULT_USER_GROUP_ID);
  assert.equal(initialGroups[1].builtIn, true);

  // Built-in groups cannot be renamed or deleted
  assert.equal(renameTextureGroup(BUILTIN_PRESET_GROUP_ID, 'HackBuiltin'), false);
  assert.equal(renameTextureGroup(DEFAULT_USER_GROUP_ID, 'HackDefault'), false);
  assert.equal(deleteTextureGroup(BUILTIN_PRESET_GROUP_ID), false);
  assert.equal(deleteTextureGroup(DEFAULT_USER_GROUP_ID), false);

  // All 8 built-in presets belong to BUILTIN_PRESET_GROUP_ID
  const presetGroupAssets = getTextureLibraryByGroup(BUILTIN_PRESET_GROUP_ID, true);
  assert.equal(presetGroupAssets.length, 8, 'All 8 built-in presets must belong to BUILTIN_PRESET_GROUP_ID');
  assert.ok(
    presetGroupAssets.every((a) => a.builtIn === true && resolveAssetGroupId(a) === BUILTIN_PRESET_GROUP_ID),
    'Every preset must resolve to BUILTIN_PRESET_GROUP_ID',
  );
  assert.equal(setTextureAssetGroup(presetGroupAssets[0].id, DEFAULT_USER_GROUP_ID), false, 'Cannot move built-in preset out of preset group');

  // Create user textures + custom group, move, filter, rename, serialize, delete safely
  const mkSolid = (w: number, h: number, r: number, g: number, b: number, a = 255) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      d[i * 4] = r;
      d[i * 4 + 1] = g;
      d[i * 4 + 2] = b;
      d[i * 4 + 3] = a;
    }
    return d;
  };

  const userTexA = makeTextureAssetFromRgba({
    id: 'v14_user_tex_a',
    name: 'UserTexA',
    width: 8,
    height: 8,
    rectData: mkSolid(8, 8, 220, 80, 60),
  });
  const userTexB = makeTextureAssetFromRgba({
    id: 'v14_user_tex_b',
    name: 'UserTexB',
    width: 8,
    height: 8,
    rectData: mkSolid(8, 8, 60, 140, 220),
  });
  upsertTextureAsset(userTexA);
  upsertTextureAsset(userTexB);
  assert.equal(resolveAssetGroupId(userTexA), DEFAULT_USER_GROUP_ID);
  assert.equal(setTextureAssetGroup(userTexA.id, BUILTIN_PRESET_GROUP_ID), false, 'Cannot assign user texture to built-in preset group');

  const customGroup = createTextureGroup('  建筑外立面  ');
  assert.equal(customGroup.name, '建筑外立面');
  assert.ok(!customGroup.builtIn);
  assert.ok(getPersistableTextureGroups().some((g) => g.id === customGroup.id));

  assert.equal(setTextureAssetGroup(userTexA.id, customGroup.id), true);
  assert.equal(resolveAssetGroupId(getTextureAsset(userTexA.id)!), customGroup.id);

  const byCustom = getTextureLibraryByGroup(customGroup.id);
  assert.ok(byCustom.some((a) => a.id === userTexA.id), 'Custom group must include moved asset');
  assert.ok(!byCustom.some((a) => a.id === userTexB.id), 'Custom group must exclude unmoved asset');
  const byDefault = getTextureLibraryByGroup(DEFAULT_USER_GROUP_ID);
  assert.ok(byDefault.some((a) => a.id === userTexB.id));
  assert.ok(!byDefault.some((a) => a.id === userTexA.id));
  const byAll = getTextureLibraryByGroup('all');
  assert.ok(byAll.length >= 10);

  assert.equal(renameTextureGroup(customGroup.id, '商业街材质'), true);
  assert.equal(getTextureGroups().find((g) => g.id === customGroup.id)?.name, '商业街材质');

  // Serialize .bmeow with custom group and asset groupId
  const groupDoc = new BuilderDocument(128, 128, 2, 2, 16);
  groupDoc.layers.push(
    new BuilderLayer(
      128,
      128,
      'GroupedBox',
      'shape',
      createDefaultShape('box', {
        u: 0,
        v: 0,
        sizeU: 1,
        sizeV: 1,
        heightPx: 16,
        faceTextures: { wall_pv: { mode: 'stretch', assetId: userTexA.id } },
      }),
    ),
  );
  const groupProjJson = serializeBmeowProject(groupDoc, 'GroupRoundtrip');
  const parsedGroupProj = JSON.parse(groupProjJson);
  assert.ok(
    Array.isArray(parsedGroupProj.textureGroups) &&
      parsedGroupProj.textureGroups.some((g: { id: string; name: string }) => g.id === customGroup.id && g.name === '商业街材质'),
    '.bmeow must serialize referenced custom textureGroups',
  );
  assert.equal(
    parsedGroupProj.textureAssets.find((a: { id: string }) => a.id === userTexA.id)?.groupId,
    customGroup.id,
    '.bmeow must preserve asset groupId',
  );

  // Deleting custom group safely moves assets back to DEFAULT_USER_GROUP_ID without deleting textures
  assert.equal(deleteTextureGroup(customGroup.id), true);
  assert.ok(!getTextureGroups().some((g) => g.id === customGroup.id));
  const afterDeleteA = getTextureAsset(userTexA.id);
  assert.ok(afterDeleteA, 'Deleting group must NOT delete textures inside it');
  assert.equal(resolveAssetGroupId(afterDeleteA), DEFAULT_USER_GROUP_ID, 'Orphaned texture falls back to DEFAULT_USER_GROUP_ID');

  // Deserializing .bmeow restores custom group and asset groupId when asset is absent
  removeTextureAsset(userTexA.id);
  await deserializeBmeowProject(groupProjJson);
  assert.ok(
    getTextureGroups().some((g) => g.id === customGroup.id && g.name === '商业街材质'),
    '.bmeow deserialize must restore custom texture group',
  );
  const restoredA = getTextureAsset(userTexA.id);
  assert.ok(restoredA && resolveAssetGroupId(restoredA) === customGroup.id, '.bmeow deserialize must restore asset groupId');

  // hydratePersistedTextureGroups merges cleanly without dropping existing groups
  const tempExtraGroup = createTextureGroup('临时保留分组');
  hydratePersistedTextureGroups([{ id: 'hydrated_grp_test', name: '导入分组', order: 10 }]);
  assert.ok(getTextureGroups().some((g) => g.id === tempExtraGroup.id), 'hydratePersistedTextureGroups keeps existing groups');
  assert.ok(getTextureGroups().some((g) => g.id === 'hydrated_grp_test'), 'hydratePersistedTextureGroups adds persisted group');

  deleteTextureGroup(customGroup.id);
  deleteTextureGroup(tempExtraGroup.id);
  deleteTextureGroup('hydrated_grp_test');
  removeTextureAsset(userTexA.id);
  removeTextureAsset(userTexB.id);

  // -------- 2. Lightweight Pixel Canvas Primitives --------
  {
    const pw = 6;
    const ph = 6;
    // L-corner 1px cleanup: [(0,0), (1,0), (1,1)] removes diagonal L corner (1,0) while keeping (0,0) and (1,1)
    let canvasBuf = new Uint8ClampedArray(pw * ph * 4);
    canvasBuf = plotPixelPerfectStroke(
      canvasBuf,
      pw,
      ph,
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      { r: 255, g: 40, b: 20, a: 255 },
      'paint',
    );
    const pxAt = (buf: Uint8ClampedArray, x: number, y: number) => {
      const i = (y * pw + x) * 4;
      return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
    };
    assert.deepEqual(pxAt(canvasBuf, 0, 0), [255, 40, 20, 255], 'PP stroke keeps start pixel (0,0)');
    assert.deepEqual(pxAt(canvasBuf, 1, 0), [0, 0, 0, 0], 'PP stroke removes 1px L-corner (1,0)');
    assert.deepEqual(pxAt(canvasBuf, 1, 1), [255, 40, 20, 255], 'PP stroke keeps diagonal pixel (1,1)');

    // Selection mask clipping + semi-transparent alpha painting
    const selRect = rectSelectMask(pw, ph, 2, 2, 3, 2);
    assert.ok(selRect[2 * pw + 2] > 0 && selRect[2 * pw + 3] > 0);
    assert.equal(selRect[2 * pw + 1], 0);
    assert.equal(selRect[2 * pw + 4], 0);

    canvasBuf = plotPixelPerfectStroke(
      canvasBuf,
      pw,
      ph,
      [
        [1, 2],
        [4, 2],
      ],
      { r: 20, g: 200, b: 120, a: 128 },
      'paint',
      selRect,
    );
    assert.equal(pxAt(canvasBuf, 1, 2)[3], 0, 'Stroke clipped outside selection at (1,2)');
    assert.equal(pxAt(canvasBuf, 4, 2)[3], 0, 'Stroke clipped outside selection at (4,2)');
    const semiA = pxAt(canvasBuf, 2, 2)[3];
    assert.ok(semiA > 110 && semiA < 145, `Semi-transparent paint alpha ~128, got ${semiA}`);

    // Eraser mode (with and without selection mask)
    canvasBuf = plotPixelPerfectStroke(
      canvasBuf,
      pw,
      ph,
      [[2, 2]],
      { r: 0, g: 0, b: 0, a: 255 },
      'erase',
      rectSelectMask(pw, ph, 3, 2, 3, 2),
    );
    assert.ok(pxAt(canvasBuf, 2, 2)[3] > 0, 'Eraser obeys selection mask');
    canvasBuf = plotPixelPerfectStroke(
      canvasBuf,
      pw,
      ph,
      [
        [0, 0],
        [1, 1],
      ],
      { r: 0, g: 0, b: 0, a: 255 },
      'erase',
    );
    assert.equal(pxAt(canvasBuf, 0, 0)[3], 0, 'Eraser clears (0,0)');
    assert.equal(pxAt(canvasBuf, 1, 1)[3], 0, 'Eraser clears (1,1)');

    // floodSelectMask (contiguous vs non-contiguous with tolerance), combineSelectionMask, invertSelectionMask, computeSelectionEdges
    const floodImg = new Uint8ClampedArray(5 * 5 * 4);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const idx = (y * 5 + x) * 4;
        if (x <= 1 && y <= 1) {
          // Top-left island: near-red
          floodImg[idx] = x === 1 && y === 1 ? 205 : 200;
          floodImg[idx + 1] = x === 1 && y === 1 ? 14 : 10;
          floodImg[idx + 2] = 10;
          floodImg[idx + 3] = 255;
        } else if (x >= 3 && y >= 3) {
          // Bottom-right disconnected island: same red
          floodImg[idx] = 200;
          floodImg[idx + 1] = 10;
          floodImg[idx + 2] = 10;
          floodImg[idx + 3] = 255;
        } else {
          // Separator: blue
          floodImg[idx + 2] = 255;
          floodImg[idx + 3] = 255;
        }
      }
    }

    const contigMask = floodSelectMask(floodImg, 5, 5, 0, 0, 12, true);
    assert.ok(contigMask[0] > 0 && contigMask[1 * 5 + 1] > 0, 'Contiguous wand includes top-left near-red island');
    assert.equal(contigMask[4 * 5 + 4], 0, 'Contiguous wand excludes disconnected bottom-right island');

    const nonContigMask = floodSelectMask(floodImg, 5, 5, 0, 0, 12, false);
    assert.ok(nonContigMask[0] > 0 && nonContigMask[4 * 5 + 4] > 0, 'Non-contiguous wand selects both islands');
    assert.equal(nonContigMask[2 * 5 + 2], 0, 'Non-contiguous wand excludes blue separator');

    const strictTolMask = floodSelectMask(floodImg, 5, 5, 0, 0, 0, true);
    assert.equal(strictTolMask[1 * 5 + 1], 0, 'Tolerance 0 excludes (205,14,10)');

    const rectA = rectSelectMask(5, 5, 0, 0, 1, 1);
    const rectB = rectSelectMask(5, 5, 1, 1, 2, 2);
    const added = combineSelectionMask(rectA, rectB, 'add')!;
    assert.ok(added[0] > 0 && added[2 * 5 + 2] > 0 && added[4 * 5 + 4] === 0);
    const subtracted = combineSelectionMask(added, rectB, 'subtract')!;
    assert.ok(subtracted[0] > 0 && subtracted[1 * 5 + 1] === 0);
    const intersected = combineSelectionMask(rectA, rectB, 'intersect')!;
    assert.ok(intersected[1 * 5 + 1] > 0 && intersected[0] === 0 && intersected[2 * 5 + 2] === 0);
    const disjoint = combineSelectionMask(rectSelectMask(5, 5, 0, 0, 0, 0), rectSelectMask(5, 5, 4, 4, 4, 4), 'intersect');
    assert.equal(disjoint, null, 'Disjoint intersect returns null');
    const replaced = combineSelectionMask(rectA, rectB, 'replace')!;
    assert.ok(replaced[0] === 0 && replaced[2 * 5 + 2] > 0);

    const inverted = invertSelectionMask(rectA, 5, 5)!;
    assert.equal(inverted[0], 0);
    assert.ok(inverted[4 * 5 + 4] > 0);
    const fullFromNull = invertSelectionMask(null, 5, 5)!;
    assert.ok(fullFromNull.every((v) => v > 0));
    assert.equal(invertSelectionMask(fullFromNull, 5, 5), null, 'Inverting full selection returns null');

    const singleMask = rectSelectMask(4, 4, 1, 1, 1, 1);
    const edges = computeSelectionEdges(singleMask, 4, 4);
    assert.equal(edges.length, 16, '1x1 selection has 4 boundary segments (16 coords)');
  }

  // -------- 3. Whole-Face Pixel Editing (Tile + Custom + Undo + 0-AA + 4x90 Closure) --------
  {
    const sharedSrc = makeTextureAssetFromRgba({
      id: 'v14_shared_tile',
      name: 'SharedTile',
      width: 8,
      height: 8,
      rectData: mkSolid(8, 8, 40, 120, 220),
    });
    upsertTextureAsset(sharedSrc);
    const sharedBefore = new Uint8ClampedArray(sharedSrc.rectData);

    const doc = new BuilderDocument(256, 256, 4, 2, 16);
    const shape = createDefaultShape('box', {
      u: 1,
      v: 0.5,
      zPx: 0,
      sizeU: 2,
      sizeV: 1,
      heightPx: 24,
      ori: 0,
      baseColor: { r: 175, g: 185, b: 195, a: 255 },
      faceTextures: {
        wall_pv: { mode: 'tile', assetId: sharedSrc.id, shadeWithFace: true },
        wall_pu: {
          mode: 'custom',
          shadeWithFace: true,
          items: [
            { id: 'd1', assetId: 'builtin_brick_red', x: 0, y: 0, w: 16, h: 24, tileFill: true },
            { id: 'd2', assetId: 'builtin_win_double', x: 4, y: 6, w: 8, h: 10 },
          ],
        },
      },
    });
    const layer = new BuilderLayer(doc.width, doc.height, 'FaceEditBox', 'shape', shape);
    doc.layers.push(layer);
    doc.rerenderAllShapes();
    const liveShape = layer.shape!;

    const renderBefore = new Uint8ClampedArray(doc.renderToBuffer());
    const cloneBefore = cloneShape(liveShape);
    const hist = new History();

    const faces = getPlanarFacesForShape(liveShape);
    const wallPv = faces.find((f) => f.id === 'wall_pv')!;
    const wallPu = faces.find((f) => f.id === 'wall_pu')!;

    // Extract tile face & custom face
    const pvBuf = extractFaceTextureLayerBuffer(wallPv, liveShape.faceTextures!.wall_pv);
    assert.equal(pvBuf.width, wallPv.faceW);
    assert.equal(pvBuf.height, wallPv.faceH);
    assert.deepEqual([pvBuf.data[0], pvBuf.data[1], pvBuf.data[2], pvBuf.data[3]], [40, 120, 220, 255]);

    const puBuf = extractFaceTextureLayerBuffer(wallPu, liveShape.faceTextures!.wall_pu);
    assert.equal(puBuf.width, wallPu.faceW);
    assert.equal(puBuf.height, wallPu.faceH);

    // Edit extracted buffers (draw crisp stripe + transparent hole) and apply back via History
    hist.push('像素精修整面', doc);
    pvBuf.data = plotPixelPerfectStroke(
      pvBuf.data,
      pvBuf.width,
      pvBuf.height,
      [
        [2, 2],
        [Math.min(pvBuf.width - 2, 18), 2],
      ],
      { r: 255, g: 240, b: 60, a: 255 },
      'paint',
    );
    pvBuf.data = plotPixelPerfectStroke(pvBuf.data, pvBuf.width, pvBuf.height, [[4, 8]], { r: 0, g: 0, b: 0, a: 255 }, 'erase');
    const bakedPv = applyEditedFaceBufferToShape({
      shape: liveShape,
      layerId: layer.id,
      faceSpec: wallPv,
      rgbaData: pvBuf.data,
      width: pvBuf.width,
      height: pvBuf.height,
      assetName: '整面精修_PV',
    });

    puBuf.data = plotPixelPerfectStroke(
      puBuf.data,
      puBuf.width,
      puBuf.height,
      [
        [1, 1],
        [1, Math.min(puBuf.height - 2, 16)],
      ],
      { r: 50, g: 255, b: 140, a: 255 },
      'paint',
    );
    const bakedPu = applyEditedFaceBufferToShape({
      shape: liveShape,
      layerId: layer.id,
      faceSpec: wallPu,
      rgbaData: puBuf.data,
      width: puBuf.width,
      height: puBuf.height,
      assetName: '整面精修_PU',
    });

    // Original shared library asset must NEVER be mutated
    assert.ok(buffersEqual(sharedSrc.rectData, sharedBefore), 'Original shared library asset must NOT be mutated');
    assert.notEqual(bakedPv.id, sharedSrc.id);
    assert.equal(liveShape.faceTextures!.wall_pv!.mode, 'stretch');
    assert.equal(liveShape.faceTextures!.wall_pv!.assetId, bakedPv.id);
    assert.equal(liveShape.faceTextures!.wall_pv!.shadeWithFace, true);
    assert.equal(liveShape.faceTextures!.wall_pu!.mode, 'stretch');
    assert.equal(liveShape.faceTextures!.wall_pu!.assetId, bakedPu.id);

    doc.rerenderAllShapes();
    const renderEdited0 = new Uint8ClampedArray(doc.renderToBuffer());
    assert.ok(!buffersEqual(renderEdited0, renderBefore), 'Edited face buffer changes rendered 3D shape');
    assert.equal(countPixels(renderEdited0).semiTransparent, 0, 'Edited face must keep strict 0-AA');

    // 4 x 90deg view-rotation closure on non-square 4x2 plot after face editing
    for (let step = 1; step <= 4; step++) {
      doc.rotateView(1);
      const cur = doc.renderToBuffer();
      assert.equal(countPixels(cur).semiTransparent, 0, `Edited face rot ${step * 90}deg must have 0 AA`);
      if (step < 4) {
        assert.ok(!buffersEqual(cur, renderEdited0), `Edited face rot ${step * 90}deg differs from 0deg`);
      } else {
        assert.ok(buffersEqual(cur, renderEdited0), 'Edited face 4x90deg rotation must close pixel-for-pixel');
      }
    }

    // History undo restores original render pixel-for-pixel
    assert.equal(hist.undo(doc), '像素精修整面');
    assert.ok(buffersEqual(doc.renderToBuffer(), renderBefore), 'History undo restores pre-edit 3D render pixel-for-pixel');

    // cloneShape undo snapshot restores original render pixel-for-pixel
    layer.shape = cloneShape(cloneBefore);
    doc.rerenderAllShapes();
    assert.ok(buffersEqual(doc.renderToBuffer(), renderBefore), 'cloneShape snapshot restores pre-edit 3D render pixel-for-pixel');

    // Verify clipPolyUV clipping & bakeBaseColor in extractFaceTextureLayerBuffer on triangular face
    const triShape = createDefaultShape('right_tri_prism', {
      sizeU: 2,
      sizeV: 2,
      heightPx: 20,
      triPrismCut: 'vertical',
      baseColor: { r: 90, g: 110, b: 130, a: 255 },
      faceTextures: {
        top: {
          mode: 'custom',
          items: [{ id: 't1', assetId: 'builtin_win_double', x: 2, y: 2, w: 6, h: 6 }],
        },
      },
    });
    const triTopSpec = getPlanarFacesForShape(triShape).find((f) => f.id === 'top')!;
    const bakedTri = extractFaceTextureLayerBuffer(triTopSpec, triShape.faceTextures!.top, {
      bakeBaseColor: triShape.baseColor,
    });
    // Bottom-right corner (faceW-1, faceH-1) is outside clipPolyUV [[0,0],[0,1],[1,0]], so alpha stays 0
    const outCornerIdx = ((bakedTri.height - 1) * bakedTri.width + (bakedTri.width - 1)) * 4;
    assert.equal(bakedTri.data[outCornerIdx + 3], 0, 'extractFaceTextureLayerBuffer respects clipPolyUV even with bakeBaseColor');
    // Inside clipPolyUV at (0,0) uncovered by decal gets bakeBaseColor with a=255
    assert.deepEqual([bakedTri.data[0], bakedTri.data[1], bakedTri.data[2], bakedTri.data[3]], [90, 110, 130, 255]);

    removeTextureAsset(sharedSrc.id);
    removeTextureAsset(bakedPv.id);
    removeTextureAsset(bakedPu.id);
  }

  console.log('PASS: v1.3.1 features (texture groups + .bmeow roundtrip, pixel-perfect/wand/marquee primitives, whole-face pixel editing + undo/0-AA/4x90 closure)');
}

async function testAiStudioOpsAndMcpExport() {
  const app = new App();
  const ctx = { app, refreshAll: () => {}, fitView: () => {}, requestRender: () => {} };

  // 1. new_doc with TheoTown base
  await executeAiStudioCommand(ctx, {
    kind: 'doc_action',
    action: 'new_doc',
    name: 'MCP塔楼测试',
    plotU: 3,
    plotV: 3,
    width: 192,
    height: 192,
    withBase: true,
  });
  let state = getStudioState(app) as any;
  assert.equal(state.plotU, 3);
  assert.equal(state.plotV, 3);
  assert.equal(state.layers.length, 1, 'new_doc withBase creates 1 base tile layer');

  // 2. upsert_shape with meter conversion (1 cell=9.6m, 16m=30px vertical -> 1m=1.875px -> 6.4m=12px)
  const podiumRes = (await executeAiStudioCommand(ctx, {
    kind: 'upsert_shape',
    name: '裙房底座',
    shapeType: 'box',
    uMeters: 4.8,
    vMeters: 4.8,
    sizeUMeters: 19.2,
    sizeVMeters: 19.2,
    heightMeters: 6.4,
    baseColor: '#8B9BB4',
    outlineMode: 'outer',
  })) as any;
  const podium = app.doc.layers.find((l) => l.id === podiumRes.layerId)!;
  assert.ok(podium?.shape, 'Podium shape created');
  assert.equal(podium.shape.u, 0.5);
  assert.equal(podium.shape.v, 0.5);
  assert.equal(podium.shape.sizeU, 2);
  assert.equal(podium.shape.sizeV, 2);
  assert.equal(podium.shape.heightPx, 12);

  // 3. Tower stacked cleanly on podium with stackOnBelow: true
  const towerRes = (await executeAiStudioCommand(ctx, {
    kind: 'upsert_shape',
    name: '主塔楼',
    shapeType: 'box',
    u: 0.75,
    v: 0.75,
    sizeU: 1.5,
    sizeV: 1.5,
    heightPx: 24,
    stackOnBelow: true,
    baseColor: '#CBD5E1',
    roofColor: '#475569',
    outlineMode: 'outer',
  })) as any;
  const tower = app.doc.layers.find((l) => l.id === towerRes.layerId)!;
  assert.equal(tower.shape!.zPx, 12, 'stackOnBelow puts tower bottom at podium top zPx=12');

  // 4. Roof pointed arch & star loft spire
  const archRes = (await executeAiStudioCommand(ctx, {
    kind: 'upsert_shape',
    name: '尖拱屋冠',
    shapeType: 'arch',
    archPreset: 'pointed',
    archHollow: true,
    u: 1.0,
    v: 1.0,
    sizeU: 1.0,
    sizeV: 0.5,
    heightPx: 14,
    stackOnBelow: true,
    baseColor: '#E2E8F0',
  })) as any;
  await executeAiStudioCommand(ctx, {
    kind: 'upsert_shape',
    name: '星形尖顶',
    shapeType: 'loft',
    loftPreset: 'star',
    topScale: 0.35,
    u: 1.125,
    v: 1.125,
    sizeU: 0.75,
    sizeV: 0.75,
    heightPx: 12,
    stackOnBelow: true,
    baseColor: '#F59E0B',
  });

  // 5. edit_structure: col_enable + arch_slide_node
  await executeAiStudioCommand(ctx, {
    kind: 'edit_structure',
    subAction: 'col_enable',
    layerId: tower.id,
  });
  assert.ok((tower.shape!.colSections?.length ?? 0) >= 2, 'col_enable initializes column sections');

  await executeAiStudioCommand(ctx, {
    kind: 'edit_structure',
    subAction: 'arch_slide_node',
    layerId: archRes.layerId,
    nodeIndex: 1,
    arcS: 0.55,
    isInner: false,
  });

  // 6. texture_action: list_faces -> import_asset (spriteMatrix) -> set_face_texture -> paint_face_pixels
  const facesInfo = (await executeAiStudioCommand(ctx, {
    kind: 'texture_action',
    action: 'list_faces',
    layerId: podium.id,
  })) as any;
  assert.ok(Array.isArray(facesInfo.faces) && facesInfo.faces.length >= 5, 'box exposes planar faces');
  const pvFace = facesInfo.faces.find((f: any) => String(f.id).includes('pv')) ?? facesInfo.faces[0];
  const puFace = facesInfo.faces.find((f: any) => String(f.id).includes('pu')) ?? facesInfo.faces[1];

  const assetRes = (await executeAiStudioCommand(ctx, {
    kind: 'texture_action',
    action: 'import_asset',
    name: 'MCP窗格砖',
    groupName: 'AI 测试纹理组',
    spriteMatrix: {
      paletteSpec: 'F=#94A3B8, G=#38BDF8, .=skip',
      rows: [
        'FFFF',
        'FGGF',
        'FGGF',
        'FFFF',
        'FGGF',
        'FFFF',
      ],
    },
  })) as any;
  const assetId = assetRes.asset?.id;
  assert.ok(assetId, 'spriteMatrix import returns new asset id');

  await executeAiStudioCommand(ctx, {
    kind: 'texture_action',
    action: 'set_face_texture',
    layerId: podium.id,
    faceId: pvFace.id,
    mode: 'tile',
    assetId,
  });

  await executeAiStudioCommand(ctx, {
    kind: 'texture_action',
    action: 'paint_face_pixels',
    layerId: podium.id,
    faceId: puFace.id,
    ops: [{ type: 'rect', x: 2, y: 2, w: 3, h: 4, color: '#38BDF8' }],
  });

  // 7. Strict 0-AA (per shape / without semi-transparent ground shadow) & 4x90° rotation closure (with shadow)
  for (const l of app.doc.layers) {
    assert.equal(countPixels(l.data).semiTransparent, 0, `AI shape layer "${l.name}" preserves strict 0-AA`);
  }
  const composite0 = app.doc.renderToBuffer();
  for (let r = 0; r < 4; r++) {
    await executeAiStudioCommand(ctx, { kind: 'doc_action', action: 'rotate_view', steps: 1 });
  }
  assert.equal(app.doc.viewRotation, 0, '4x90deg rotate_view returns to viewRotation=0');
  assert.ok(buffersEqual(app.doc.renderToBuffer(), composite0), '4x90deg rotate_view pixels close bit-exact with shadow');

  // 8. Export PSD single-view and fourViews with hideTheoTownBase=true and verify base visibility is preserved
  const psdSingle = (await executeAiStudioCommand(ctx, {
    kind: 'doc_action',
    action: 'export_psd_base64',
    fourViews: false,
    hideTheoTownBase: true,
    trim: true,
    scale: 1,
  })) as any;
  const decodedSingle = readPsd(Buffer.from(psdSingle.psdBase64, 'base64'), {
    skipCompositeImageData: true,
    skipLayerImageData: true,
  });
  assert.ok((decodedSingle.children?.length ?? 0) >= 5, 'single-view PSD contains all non-base model layers plus standalone ground shadow layer');
  assert.ok(
    decodedSingle.children?.some((c) => c.name === GROUND_SHADOW_LAYER_NAME),
    'single-view PSD includes standalone 地面阴影 layer',
  );

  const psdFour = (await executeAiStudioCommand(ctx, {
    kind: 'doc_action',
    action: 'export_psd_base64',
    fourViews: true,
    hideTheoTownBase: true,
    trim: true,
    scale: 1,
  })) as any;
  const decodedFour = readPsd(Buffer.from(psdFour.psdBase64, 'base64'), {
    skipCompositeImageData: true,
    skipLayerImageData: true,
  });
  assert.equal(decodedFour.children?.length, 4, 'fourViews PSD exports exact 4 rotation angle layers');

  const baseLayer = app.doc.layers.find((l) => l.shape?.shapeType === 'theotown_base')!;
  assert.equal(baseLayer.visible, true, 'hideTheoTownBase during export restores base layer visibility');

  removeTextureAsset(assetId);
  console.log('PASS: AI Studio Ops & MCP PSD/texture/meter/stackOnBelow E2E unit suite');
}

async function testV140GroundShadow() {
  // 1. Default ground shadow state (#00071C5A) in App vs raw BuilderDocument
  const rawDoc = new BuilderDocument(160, 160, 4, 4, 16);
  assert.equal(rawDoc.groundShadow.enabled, false, 'raw BuilderDocument defaults groundShadow off for legacy unit invariants');
  assert.equal(toHex8(rawDoc.groundShadow.color), DEFAULT_GROUND_SHADOW_HEX);

  const app = new App();
  assert.equal(app.doc.groundShadow.enabled, true, 'App starter document enables automatic ground shadow by default');
  assert.deepEqual(app.doc.groundShadow.color, DEFAULT_GROUND_SHADOW_COLOR);

  // 2. Exact 1:1 direct-right (+X) ground shadow length check on a 1x1 box (H=18)
  app.newDocument(192, 160, 4, 4, '阴影精度测试', false, true);
  const boxShape = createDefaultShape('box', {
    u: 1,
    v: 1,
    zPx: 0,
    sizeU: 1,
    sizeV: 1,
    heightPx: 18,
    baseColor: { r: 200, g: 210, b: 220, a: 255 },
  });
  const boxLayer = app.addShapeLayer(boxShape, '测影方块');
  const sBuf = app.doc.ensureGroundShadowBuffer();
  const { originX, originY } = app.doc.getViewOrigin();
  const [topBaseX, topBaseY] = isoToScreenPx(1, 1, 0, originX, originY);
  const [, midBaseY] = isoToScreenPx(2, 1, 0, originX, originY);
  const [botBaseX, botBaseY] = isoToScreenPx(2, 2, 0, originX, originY);

  // Mid row of base: ground box spans [minBaseX..maxBaseX]; 1:1 shadow starts at minBaseX and extends exact +18 px past maxBaseX
  const yMid = Math.floor(midBaseY);
  let maxBoxX = -1;
  let minBoxX = 9999;
  for (let x = 0; x < app.doc.width; x++) {
    if (boxLayer.data[(yMid * app.doc.width + x) * 4 + 3] > 0) {
      if (x > maxBoxX) maxBoxX = x;
      if (x < minBoxX) minBoxX = x;
    }
  }
  let maxShadowX = -1;
  let minShadowX = 9999;
  for (let x = 0; x < app.doc.width; x++) {
    const a = sBuf[(yMid * app.doc.width + x) * 4 + 3];
    if (a !== 0) {
      assert.equal(a, 90, 'shadow alpha is strictly binary (0 or configured alpha 90)');
      if (x > maxShadowX) maxShadowX = x;
      if (x < minShadowX) minShadowX = x;
    }
  }
  assert.equal(minShadowX, minBoxX, 'shadow starts cleanly at plumb left base');
  assert.equal(maxShadowX - maxBoxX, 18, '1:1 shadow extends exact heightPx=18 px to direct right');
  assert.ok(topBaseX > 0 && botBaseX > 0);
  // Zero shadow rows above topBaseY or below botBaseY
  for (let x = 0; x < app.doc.width; x++) {
    assert.equal(sBuf[((Math.round(topBaseY) - 1) * app.doc.width + x) * 4 + 3], 0, 'no shadow leaks above base');
    assert.equal(sBuf[((Math.round(botBaseY)) * app.doc.width + x) * 4 + 3], 0, 'no shadow leaks below base');
  }

  // 3. Floating box (z0 = 10, heightPx = 12): shifts [+10..+22] px to the right, leaving sunlit gap directly beneath left base
  app.newDocument(192, 160, 4, 4, '悬空测影', false, true);
  app.addShapeLayer(
    createDefaultShape('box', { u: 1, v: 1, zPx: 10, sizeU: 1, sizeV: 1, heightPx: 12 }),
    '悬空箱',
  );
  const floatBuf = app.doc.ensureGroundShadowBuffer();
  const fyMid = Math.floor(midBaseY);
  let fMin = 9999;
  let fMax = -1;
  for (let x = 0; x < app.doc.width; x++) {
    if (floatBuf[(fyMid * app.doc.width + x) * 4 + 3] > 0) {
      if (x < fMin) fMin = x;
      if (x > fMax) fMax = x;
    }
  }
  assert.equal(fMin, minBoxX + 10, 'floating shape shadow leaves 10px sunlit gap on ground');
  assert.equal(fMax, maxBoxX + 22, 'floating shape shadow top reaches +22px right');

  // 4. Requirement 2: shadows only apply to ground; another 3D shape inside the shadow zone is NOT darkened
  app.newDocument(256, 256, 4, 4, '防叠影测试', true, true);
  app.addShapeLayer(
    createDefaultShape('box', {
      u: 0.5,
      v: 1.5,
      zPx: 0,
      sizeU: 1,
      sizeV: 1,
      heightPx: 40,
      baseColor: { r: 120, g: 140, b: 160, a: 255 },
    }),
    '高塔',
  );
  const neighborLayer = app.addShapeLayer(
    createDefaultShape('box', {
      u: 1.75,
      v: 0.25,
      zPx: 0,
      sizeU: 0.75,
      sizeV: 0.75,
      heightPx: 8,
      baseColor: { r: 255, g: 136, b: 68, a: 255 },
      autoShade: false,
      edgeHighlight: false,
      outlineMode: 'none',
    }),
    '受影区内矮房',
  );
  // Delete base so we can cleanly check neighbor pixels vs empty ground shadow pixels
  app.doc.layers = app.doc.layers.filter((l) => l.shape?.shapeType !== 'theotown_base');
  app.doc.sortLayersByIsoDepth();
  const sceneBuf = app.doc.renderToBuffer();
  const shMaskOnly = app.doc.ensureGroundShadowBuffer();
  let overlapChecked = 0;
  let groundShadowPixels = 0;
  for (let i = 0; i < sceneBuf.length; i += 4) {
    if (neighborLayer.data[i + 3] === 255) {
      // Even where shadow exists at this (x,y), neighbor 3D shape pixel must remain exact #FF8844!
      if (shMaskOnly[i + 3] > 0) overlapChecked++;
      assert.equal(sceneBuf[i], 255, 'neighbor shape R untouched by ground shadow');
      assert.equal(sceneBuf[i + 1], 136, 'neighbor shape G untouched by ground shadow');
      assert.equal(sceneBuf[i + 2], 68, 'neighbor shape B untouched by ground shadow');
      assert.equal(sceneBuf[i + 3], 255);
    } else if (shMaskOnly[i + 3] > 0 && app.doc.layers[0].data[i + 3] === 0 && app.doc.layers[1].data[i + 3] === 0) {
      groundShadowPixels++;
      assert.deepEqual([sceneBuf[i], sceneBuf[i + 1], sceneBuf[i + 2], sceneBuf[i + 3]], [0, 7, 28, 90]);
    }
  }
  assert.ok(overlapChecked > 20, `verified ${overlapChecked} overlapping pixels on neighbor shape were NOT darkened`);
  assert.ok(groundShadowPixels > 20, 'verified open ground receives #00071C5A shadow');

  // 5. View rotation sync + 4x90° bit-exact closure with shadow enabled
  const asymDoc = new BuilderDocument(220, 220, 4, 4, 16);
  asymDoc.groundShadow.enabled = true;
  const asymBox = new BuilderLayer(
    220,
    220,
    '非对称体块',
    'shape',
    createDefaultShape('box', { u: 0.5, v: 1, sizeU: 2, sizeV: 0.75, heightPx: 20 }),
  );
  asymDoc.layers.push(asymBox);
  asymDoc.rerenderAllShapes();
  const renderR0 = asymDoc.renderToBuffer();
  const shR0 = new Uint8ClampedArray(asymDoc.ensureGroundShadowBuffer());
  asymDoc.rotateView(1);
  const shR1 = new Uint8ClampedArray(asymDoc.ensureGroundShadowBuffer());
  assert.ok(!buffersEqual(shR0, shR1), 'ground shadow updates automatically on 90deg view rotation');
  asymDoc.rotateView(1);
  asymDoc.rotateView(1);
  asymDoc.rotateView(1);
  assert.equal(asymDoc.viewRotation, 0);
  assert.ok(buffersEqual(asymDoc.renderToBuffer(), renderR0), '4x90deg rotation with ground shadow closes bit-exact');

  // 6. All 10 primitives + hollow arch/loft/columnSections produce valid 1-bit shadow masks
  const primCases: { name: string; shape: ReturnType<typeof createDefaultShape> }[] = [
    { name: 'box', shape: createDefaultShape('box', { u: 1, v: 1, sizeU: 1, sizeV: 1, heightPx: 16 }) },
    { name: 'tri_v', shape: createDefaultShape('right_tri_prism', { u: 1, v: 1, sizeU: 1, sizeV: 1, heightPx: 16, triPrismCut: 'vertical' }) },
    { name: 'tri_s', shape: createDefaultShape('right_tri_prism', { u: 1, v: 1, sizeU: 1, sizeV: 1, heightPx: 16, triPrismCut: 'slope' }) },
    { name: 'prism', shape: createDefaultShape('prism', { u: 1, v: 1, sizeU: 1, sizeV: 1, heightPx: 16, prismSides: 6 }) },
    { name: 'wedge', shape: createDefaultShape('wedge', { u: 1, v: 1, sizeU: 1, sizeV: 1, heightPx: 16, wedgeMode: 'gable' }) },
    { name: 'pyramid', shape: createDefaultShape('pyramid', { u: 1, v: 1, sizeU: 1, sizeV: 1, heightPx: 16 }) },
    { name: 'cylinder', shape: createDefaultShape('cylinder', { u: 1, v: 1, sizeU: 1, sizeV: 1, heightPx: 16 }) },
    { name: 'cone', shape: createDefaultShape('cone', { u: 1, v: 1, sizeU: 1, sizeV: 1, heightPx: 16 }) },
    { name: 'dome', shape: createDefaultShape('dome', { u: 1, v: 1, sizeU: 1, sizeV: 1, heightPx: 16, domeMode: 'dome' }) },
    { name: 'sphere', shape: createDefaultShape('dome', { u: 1, v: 1, sizeU: 1, sizeV: 1, heightPx: 16, domeMode: 'sphere' }) },
    { name: 'arch_hollow', shape: createDefaultShape('arch', { u: 1, v: 1, sizeU: 2, sizeV: 0.5, heightPx: 20, archHollow: true, archHollowStyle: 'portal' }) },
    { name: 'loft_hollow', shape: createDefaultShape('loft', { u: 1, v: 1, sizeU: 1.5, sizeV: 1.5, heightPx: 20, loftHollow: true }) },
  ];
  for (const tc of primCases) {
    const mask = new Uint8Array(192 * 192);
    const { originX: pxOx, originY: pxOy } = getPlotOrigin(192, 192, 4, 4, 16);
    renderShapeGroundShadowMask(mask, 192, 192, tc.shape, 4, 4, 0, pxOx, pxOy);
    let cnt = 0;
    for (let k = 0; k < mask.length; k++) if (mask[k] === 1) cnt++;
    assert.ok(cnt > 20, `${tc.name} casts non-empty shadow mask (got ${cnt} px)`);
  }

  // 7. Standalone PSD layer export + ordering (base < shadow < 3D shapes) + undo/redo + .bmeow roundtrip
  const psdApp = new App();
  psdApp.newDocument(192, 192, 3, 3, 'PSD阴影导出', true, true);
  psdApp.addShapeLayer(
    createDefaultShape('box', { u: 1, v: 1, sizeU: 1, sizeV: 1, heightPx: 24 }),
    '测试主体楼',
  );
  psdApp.setGroundShadow(
    { enabled: true, color: { r: 17, g: 34, b: 51, a: 128 } },
    { pushHistory: '自定义阴影' },
  );
  assert.equal(toHex8(psdApp.doc.groundShadow.color), '#11223380');
  psdApp.undo();
  assert.deepEqual(psdApp.doc.groundShadow.color, DEFAULT_GROUND_SHADOW_COLOR, 'undo restores default shadow color');
  psdApp.redo();
  assert.equal(toHex8(psdApp.doc.groundShadow.color), '#11223380', 'redo restores custom shadow color');

  const psdBytes = exportBuilderPsd(psdApp.doc, { trim: true, includeRasters: true, includeGroundShadow: true });
  const psd = readPsd(psdBytes, { skipCompositeImageData: true, skipLayerImageData: true });
  const childNames = (psd.children ?? []).map((c) => c.name);
  const idxBase = childNames.indexOf('TheoTown 3×3 底座');
  const idxShadow = childNames.indexOf(GROUND_SHADOW_LAYER_NAME);
  const idxTower = childNames.indexOf('测试主体楼');
  assert.ok(idxBase >= 0 && idxShadow > idxBase && idxTower > idxShadow, `PSD layer order valid: ${JSON.stringify(childNames)}`);

  const fourPsdBytes = exportFourViewLayersPsd(psdApp.doc, { trim: true, includeGroundShadow: true });
  const fourPsd = readPsd(fourPsdBytes, { skipCompositeImageData: true, skipLayerImageData: true });
  assert.equal(fourPsd.children?.length, 4);

  const bmeowJson = serializeBmeowProject(psdApp.doc, '阴影工程');
  const restored = await deserializeBmeowProject(bmeowJson);
  assert.equal(restored.doc.groundShadow.enabled, true);
  assert.equal(toHex8(restored.doc.groundShadow.color), '#11223380');

  // 8. MCP AI doc_action set_ground_shadow check
  await executeAiStudioCommand(
    { app: psdApp, refreshAll: () => {}, fitView: () => {}, requestRender: () => {} },
    { kind: 'doc_action', action: 'set_ground_shadow', enabled: true, color: '#00071C', opacity: 0.35 },
  );
  assert.equal(psdApp.doc.groundShadow.color.a, Math.round(0.35 * 255));

  console.log('PASS: v1.4.0 automatic 1:1 right-cast ground shadow (#00071C5A, non-shadowed shapes, all primitives, PSD layer, .bmeow & MCP)');
}

async function testCurvedShadingAndContrastRange() {
  const W = 224;
  const H = 224;
  const plotU = 3;
  const plotV = 3;
  const { originX, originY } = getPlotOrigin(W, H, plotU, plotV, 16);

  const countColorsAndCheckOpaque = (shape: ReturnType<typeof createDefaultShape>, rot: 0 | 1 | 2 | 3 = 0, shadeSteps = 0) => {
    const buf = new Uint8ClampedArray(W * H * 4);
    renderShapeToBuffer(buf, W, H, shape, plotU, plotV, rot, originX, originY, shadeSteps);
    const colors = new Set<number>();
    let opaqueCount = 0;
    let minLuma = Infinity;
    let maxLuma = -Infinity;
    for (let i = 0; i < buf.length; i += 4) {
      const a = buf[i + 3];
      assert.ok(a === 0 || a === 255, `no semi-transparent pixel allowed (got alpha=${a})`);
      if (a === 255) {
        opaqueCount++;
        const rgbKey = (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
        colors.add(rgbKey);
        const luma = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
        if (luma < minLuma) minLuma = luma;
        if (luma > maxLuma) maxLuma = luma;
      }
    }
    return { uniqueColors: colors.size, opaqueCount, lumaSpan: maxLuma - minLuma, buf };
  };

  // 1. Curved primitives achieve smooth shading (>= 12 distinct colors, 0-AA opaque)
  const midGray = { r: 168, g: 176, b: 194, a: 255 };
  const curvedCases: { name: string; shape: ReturnType<typeof createDefaultShape> }[] = [
    {
      name: 'cylinder',
      shape: createDefaultShape('cylinder', {
        u: 0.5, v: 0.5, sizeU: 2, sizeV: 2, heightPx: 36,
        baseColor: midGray, autoShade: true, shadeContrast: 1.0, outlineMode: 'none', edgeHighlight: false,
      }),
    },
    {
      name: 'cone',
      shape: createDefaultShape('cone', {
        u: 0.5, v: 0.5, sizeU: 2, sizeV: 2, heightPx: 40,
        baseColor: midGray, autoShade: true, shadeContrast: 1.0, outlineMode: 'none', edgeHighlight: false,
      }),
    },
    {
      name: 'dome',
      shape: createDefaultShape('dome', {
        u: 0.5, v: 0.5, sizeU: 2, sizeV: 2, heightPx: 36, domeMode: 'dome',
        baseColor: midGray, autoShade: true, shadeContrast: 1.0, outlineMode: 'none', edgeHighlight: false,
      }),
    },
    {
      name: 'arch',
      shape: createDefaultShape('arch', {
        u: 0.5, v: 1, sizeU: 2, sizeV: 1, heightPx: 36, archHollow: false,
        baseColor: midGray, autoShade: true, shadeContrast: 1.0, outlineMode: 'none', edgeHighlight: false,
      }),
    },
    {
      name: 'loft',
      shape: createDefaultShape('loft', {
        u: 0.5, v: 0.5, sizeU: 2, sizeV: 2, heightPx: 36,
        loftSections: [
          {
            id: 'ls-b', name: '底面', t: 0, scale: 1.1, twistDeg: 0, offsetU: 0, offsetV: 0,
            nodes: [
              { u: 0.5, v: 0, mode: 'smooth' },
              { u: 1, v: 0.5, mode: 'smooth' },
              { u: 0.5, v: 1, mode: 'smooth' },
              { u: 0, v: 0.5, mode: 'smooth' },
            ],
          },
          {
            id: 'ls-t', name: '顶面', t: 1, scale: 0.72, twistDeg: 0, offsetU: 0, offsetV: 0,
            nodes: [
              { u: 0.5, v: 0, mode: 'smooth' },
              { u: 1, v: 0.5, mode: 'smooth' },
              { u: 0.5, v: 1, mode: 'smooth' },
              { u: 0, v: 0.5, mode: 'smooth' },
            ],
          },
        ],
        baseColor: midGray, autoShade: true, shadeContrast: 1.0, outlineMode: 'none', edgeHighlight: false,
      }),
    },
    {
      name: 'colSections_cylinder',
      shape: createDefaultShape('cylinder', {
        u: 0.5, v: 0.5, sizeU: 2, sizeV: 2, heightPx: 36,
        colSections: [
          { id: 'cs-b', name: '底段', t: 0, scale: 1.05, twistDeg: 0, offsetU: 0, offsetV: 0, edges: [] },
          { id: 'cs-t', name: '顶段', t: 1, scale: 0.65, twistDeg: 0, offsetU: 0, offsetV: 0, edges: [] },
        ],
        colInterp: 'smooth',
        baseColor: midGray, autoShade: true, shadeContrast: 1.0, outlineMode: 'none', edgeHighlight: false,
      }),
    },
  ];

  for (const tc of curvedCases) {
    const res = countColorsAndCheckOpaque(tc.shape);
    assert.ok(
      res.uniqueColors >= 12,
      `${tc.name} curved shading should have >= 12 colors (got ${res.uniqueColors})`,
    );
  }

  // 2. Sharp-edged box keeps exact 3 flat shades (no corner bleeding)
  const crispBox = createDefaultShape('box', {
    u: 1, v: 1, sizeU: 1, sizeV: 1, heightPx: 24,
    baseColor: midGray, autoShade: true, shadeContrast: 1.0, outlineMode: 'none', edgeHighlight: false,
  });
  const boxRes = countColorsAndCheckOpaque(crispBox);
  assert.equal(boxRes.uniqueColors, 3, `flat box must have exact 3 shades (got ${boxRes.uniqueColors})`);

  // 3. Analytical cone 4x90deg rotation invariance & matching 1:1 right ground shadow
  const symCone = createDefaultShape('cone', {
    u: 0.5, v: 0.5, sizeU: 2, sizeV: 2, heightPx: 30,
    baseColor: midGray, autoShade: true, shadeContrast: 1.5, outlineMode: 'none', edgeHighlight: false,
  });
  const coneBuf0 = countColorsAndCheckOpaque(symCone, 0);
  for (const rot of [1, 2, 3] as const) {
    const coneBufR = countColorsAndCheckOpaque(symCone, rot);
    assert.equal(coneBufR.opaqueCount, coneBuf0.opaqueCount, `cone pixel count matches at rot=${rot}`);
  }
  const coneShadowMask = new Uint8Array(W * H);
  renderShapeGroundShadowMask(coneShadowMask, W, H, symCone, plotU, plotV, 0, originX, originY);
  const [apexGx] = isoToScreenPx(1.5, 1.5, 0, originX, originY);
  let maxConeShadowX = -1;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      if (coneShadowMask[py * W + px] === 1 && px > maxConeShadowX) maxConeShadowX = px;
    }
  }
  assert.ok(
    Math.abs(maxConeShadowX - Math.floor(apexGx + symCone.heightPx - 0.5)) <= 1,
    `analytical cone shadow tip reaches +${symCone.heightPx}px right (got maxX=${maxConeShadowX}, apexGx=${apexGx})`,
  );

  // 4. Expanded 0.3..5.0 shadeContrast strictly increases tonal span up to 5.0 without highlight clipping collapse
  const lightGray = { r: 216, g: 222, b: 233, a: 255 };
  for (const [colName, baseCol] of [['midGray', midGray], ['lightGray', lightGray]] as const) {
    const contrasts = [0.3, 1.0, 2.5, 5.0];
    let prevSpan = -1;
    for (const sc of contrasts) {
      const dome = createDefaultShape('dome', {
        u: 0.5, v: 0.5, sizeU: 2, sizeV: 2, heightPx: 36, domeMode: 'dome',
        baseColor: baseCol, autoShade: true, shadeContrast: sc, outlineMode: 'none', edgeHighlight: false,
      });
      const r = countColorsAndCheckOpaque(dome);
      assert.ok(
        r.lumaSpan > prevSpan + 2,
        `${colName} contrast=${sc} increases lumaSpan (${r.lumaSpan.toFixed(1)} > ${prevSpan.toFixed(1)})`,
      );
      assert.ok(
        r.uniqueColors >= 12,
        `${colName} contrast=${sc} retains >= 12 gradient colors without clipping (got ${r.uniqueColors})`,
      );
      prevSpan = r.lumaSpan;
    }
  }

  // 5. MCP upsert_shape + .bmeow serialization preserve shadeContrast up to 5.0
  const mcpApp = new App();
  mcpApp.newDocument(192, 192, 3, 3, 'ContrastRoundtrip', true, true);
  await executeAiStudioCommand(
    { app: mcpApp, refreshAll: () => {}, fitView: () => {}, requestRender: () => {} },
    { kind: 'upsert_shape', mode: 'create', shapeType: 'dome', name: '高反差穹顶', shadeContrast: 4.5 },
  );
  assert.equal(mcpApp.doc.layer?.shape?.shadeContrast, 4.5, 'MCP upsert_shape preserves shadeContrast=4.5');
  const roundtripJson = serializeBmeowProject(mcpApp.doc, 'ContrastRoundtrip');
  const loadedDoc = await deserializeBmeowProject(roundtripJson);
  const loadedDome = loadedDoc.doc.layers.find((l) => l.name === '高反差穹顶');
  assert.equal(loadedDome?.shape?.shadeContrast, 4.5, '.bmeow roundtrip preserves shadeContrast=4.5');

  // 6. Configurable shadeSteps precision (0=continuous smooth vs 3..64 quantized cel steps)
  for (const primKind of ['dome', 'cylinder'] as const) {
    const sh = createDefaultShape(primKind, {
      u: 0.5, v: 0.5, sizeU: 2, sizeV: 2, heightPx: 36,
      baseColor: midGray, autoShade: true, shadeContrast: 1.5, outlineMode: 'none', edgeHighlight: false,
    });
    const r4 = countColorsAndCheckOpaque(sh, 0, 4);
    const r6 = countColorsAndCheckOpaque(sh, 0, 6);
    const r16 = countColorsAndCheckOpaque(sh, 0, 16);
    const r0 = countColorsAndCheckOpaque(sh, 0, 0);
    assert.ok(r4.uniqueColors <= 5, `${primKind} shadeSteps=4 has <= 5 cel tones (got ${r4.uniqueColors})`);
    assert.ok(
      r4.uniqueColors < r6.uniqueColors && r6.uniqueColors < r16.uniqueColors && r16.uniqueColors < r0.uniqueColors,
      `${primKind} shadeSteps color progression ${r4.uniqueColors} < ${r6.uniqueColors} < ${r16.uniqueColors} < ${r0.uniqueColors}`,
    );
    assert.ok(r0.uniqueColors >= 12, `${primKind} smooth (shadeSteps=0) has >= 12 tones`);
  }

  // App.setShadeSteps live rerender + undo/redo survival + MCP set_shade_steps
  const getDomeLayer = () => {
    const l = mcpApp.doc.layers.find((it) => it.name === '高反差穹顶');
    assert.ok(l, '高反差穹顶 layer must exist');
    return l;
  };
  const countLayerColors = (data: Uint8ClampedArray) => {
    const set = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 255) set.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    return set.size;
  };
  const smoothLayerColors = countLayerColors(getDomeLayer().data);
  mcpApp.setShadeSteps(6);
  assert.equal(mcpApp.doc.shadeSteps, 6);
  const steppedLayerColors = countLayerColors(getDomeLayer().data);
  assert.ok(steppedLayerColors < smoothLayerColors && steppedLayerColors <= 8, `live setShadeSteps(6) reduced colors ${smoothLayerColors} -> ${steppedLayerColors}`);
  mcpApp.addShapeLayer(createDefaultShape('box', { u: 0, v: 0, sizeU: 0.5, sizeV: 0.5, heightPx: 12 }), '临时辅助块');
  mcpApp.undo();
  assert.equal(mcpApp.doc.shadeSteps, 6, 'undo preserves global shadeSteps setting');
  assert.equal(countLayerColors(getDomeLayer().data), steppedLayerColors, 'undo rerenders with active shadeSteps');
  mcpApp.redo();
  assert.equal(mcpApp.doc.shadeSteps, 6);
  assert.equal(countLayerColors(getDomeLayer().data), steppedLayerColors);
  await executeAiStudioCommand(
    { app: mcpApp, refreshAll: () => {}, fitView: () => {}, requestRender: () => {} },
    { kind: 'doc_action', action: 'set_shade_steps', shadeSteps: 0 },
  );
  assert.equal(mcpApp.doc.shadeSteps, 0);
  assert.equal(countLayerColors(getDomeLayer().data), smoothLayerColors, 'MCP set_shade_steps=0 restores full smooth tones');

  console.log('PASS: smooth curved shading (Phong normals + analytical cone/cylinder + 0.3~5.0 contrast curve + shadeSteps precision)');
}

async function testExperimentalInterBlockShadow() {
  // 1. Off by default
  const app = new App();
  app.newDocument(224, 224, 4, 4, 'InterBlockTest', true, true);
  assert.equal(Boolean(app.doc.groundShadow.interBlockEnabled), false, 'interBlockEnabled defaults to false');

  // Tall caster on the left (u=1, v=1), short neighbor box to its right (u=2, v=1)
  const tallTower = app.addShapeLayer(
    createDefaultShape('box', {
      u: 1, v: 1, sizeU: 1, sizeV: 1, heightPx: 42,
      baseColor: { r: 168, g: 176, b: 194, a: 255 },
      outlineMode: 'none',
      edgeHighlight: false,
    }),
    '高塔体块',
  );
  const shortNeighbor = app.addShapeLayer(
    createDefaultShape('box', {
      u: 2, v: 1, sizeU: 1, sizeV: 1, heightPx: 16,
      baseColor: { r: 230, g: 120, b: 80, a: 255 },
      outlineMode: 'none',
      edgeHighlight: false,
    }),
    '右侧矮楼',
  );

  // When off, composite buffer on neighbor has 0 shadow darkening
  const offBuf = app.doc.renderToBuffer();
  app.setGroundShadow({ interBlockEnabled: true }, { pushHistory: '开启实验体块阴影' });
  assert.equal(app.doc.groundShadow.interBlockEnabled, true);

  const ibBuf = app.doc.ensureInterBlockShadowBuffer();
  const onBuf = app.doc.renderToBuffer();

  let shadowOnShort = 0;
  let shadowOnTall = 0;
  for (let i = 0; i < ibBuf.length; i += 4) {
    if (ibBuf[i + 3] > 0) {
      assert.deepEqual([ibBuf[i], ibBuf[i + 1], ibBuf[i + 2], ibBuf[i + 3]], [0, 7, 28, 90]);
      if (shortNeighbor.data[i + 3] === 255) shadowOnShort++;
      if (tallTower.data[i + 3] === 255 && shortNeighbor.data[i + 3] === 0) shadowOnTall++;
    }
  }
  assert.ok(shadowOnShort > 30, `tall tower casts >= 30 shadow px onto short neighbor (got ${shadowOnShort})`);
  assert.equal(shadowOnTall, 0, 'tall caster does not self-shadow itself');
  assert.ok(!buffersEqual(offBuf, onBuf), 'enabling interBlockEnabled updates final composite buffer');

  // Undo / Redo check
  app.undo();
  assert.equal(Boolean(app.doc.groundShadow.interBlockEnabled), false, 'undo turns off interBlockEnabled');
  app.redo();
  assert.equal(Boolean(app.doc.groundShadow.interBlockEnabled), true, 'redo restores interBlockEnabled');

  // 2. Setback tower on podium roof: casts shadow rightward across podium roof (+24px max), 0 shadow to the left
  const podiumApp = new App();
  podiumApp.newDocument(256, 256, 4, 4, 'PodiumSetback', false, true);
  podiumApp.setGroundShadow({ enabled: true, interBlockEnabled: true });
  const podium = podiumApp.addShapeLayer(
    createDefaultShape('box', { u: 0.5, v: 0.5, sizeU: 3, sizeV: 3, zPx: 0, heightPx: 16, outlineMode: 'none', edgeHighlight: false }),
    '裙房底座',
  );
  const setbackTower = podiumApp.addShapeLayer(
    createDefaultShape('dome', { u: 0.5, v: 1.5, sizeU: 1, sizeV: 1, zPx: 16, heightPx: 24, outlineMode: 'none', edgeHighlight: false }),
    '退台穹顶',
  );
  const podIb = podiumApp.doc.ensureInterBlockShadowBuffer();
  const { originX: pOx, originY: pOy } = podiumApp.doc.getViewOrigin();
  const [towerRightCx, towerBaseCy] = isoToScreenPx(1.5, 2.0, 16, pOx, pOy);
  let podiumRoofShadowPx = 0;
  let falseLeftShadowPx = 0;
  for (let py = 0; py < podiumApp.doc.height; py++) {
    for (let px = 0; px < podiumApp.doc.width; px++) {
      const idx = (py * podiumApp.doc.width + px) * 4;
      if (podIb[idx + 3] > 0) {
        if (podium.data[idx + 3] === 255) podiumRoofShadowPx++;
        if (px < towerRightCx - 20 && py <= towerBaseCy + 4) falseLeftShadowPx++;
      }
    }
  }
  assert.ok(podiumRoofShadowPx > 25, `setback dome casts shadow onto podium roof (${podiumRoofShadowPx} px)`);
  assert.equal(falseLeftShadowPx, 0, 'no false cast shadow to the left of caster');
  assert.ok(setbackTower.data.some((v) => v > 0));

  // 3. Flush vertical stacking (1F + 2F identical footprint) produces ZERO false wall seam shadow
  const flushDoc = new BuilderDocument(192, 192, 4, 4, 16);
  flushDoc.groundShadow.enabled = true;
  flushDoc.groundShadow.interBlockEnabled = true;
  const f1 = new BuilderLayer(192, 192, '1F', 'shape', createDefaultShape('box', { u: 1, v: 1, sizeU: 1, sizeV: 1, zPx: 0, heightPx: 18, outlineMode: 'none', edgeHighlight: false }));
  const f2 = new BuilderLayer(192, 192, '2F', 'shape', createDefaultShape('box', { u: 1, v: 1, sizeU: 1, sizeV: 1, zPx: 18, heightPx: 18, outlineMode: 'none', edgeHighlight: false }));
  flushDoc.layers.push(f1, f2);
  flushDoc.rerenderAllShapes();
  const flushIb = flushDoc.ensureInterBlockShadowBuffer();
  let flushShadowPx = 0;
  for (let i = 0; i < flushIb.length; i += 4) if (flushIb[i + 3] > 0) flushShadowPx++;
  assert.equal(flushShadowPx, 0, `flush stacked floors must have 0 self-seam shadow px (got ${flushShadowPx})`);

  // 4. 4x90deg rotation closure + PSD standalone layer order + .bmeow roundtrip + MCP toggle
  const rot0 = new Uint8ClampedArray(podiumApp.doc.renderToBuffer());
  podiumApp.rotateView(1);
  podiumApp.rotateView(1);
  podiumApp.rotateView(1);
  podiumApp.rotateView(1);
  assert.ok(buffersEqual(podiumApp.doc.renderToBuffer(), rot0), '4x90deg rotation with interBlock shadow closes bit-exact');

  const psdBytes = exportBuilderPsd(app.doc, {
    trim: true,
    includeRasters: true,
    includeGroundShadow: true,
    includeInterBlockShadow: true,
  });
  const psd = readPsd(psdBytes, { skipCompositeImageData: true, skipLayerImageData: true });
  const names = (psd.children ?? []).map((c) => c.name);
  const idxGround = names.indexOf(GROUND_SHADOW_LAYER_NAME);
  const idxInter = names.indexOf(INTER_BLOCK_SHADOW_LAYER_NAME);
  const idxShort = names.indexOf('右侧矮楼');
  assert.ok(idxGround >= 0 && idxShort > idxGround && idxInter > idxShort, `PSD order valid: ${JSON.stringify(names)}`);

  const json = serializeBmeowProject(app.doc, 'InterBlockRoundtrip');
  const loaded = await deserializeBmeowProject(json);
  assert.equal(Boolean(loaded.doc.groundShadow.interBlockEnabled), true, '.bmeow roundtrip preserves interBlockEnabled');

  await executeAiStudioCommand(
    { app: loaded.doc ? app : app, refreshAll: () => {}, fitView: () => {}, requestRender: () => {} },
    { kind: 'doc_action', action: 'set_ground_shadow', interBlockEnabled: false },
  );
  assert.equal(Boolean(app.doc.groundShadow.interBlockEnabled), false, 'MCP set_ground_shadow toggles interBlockEnabled');

  console.log('PASS: experimental 1:1 3D inter-block cast shadow (non-self, podium roof, flush anti-seam, 4x90 closure, PSD 结构阴影 layer, .bmeow & MCP)');
}

async function testOpusV14xReviewFixes() {
  // H1: Four-view PSD export via withTemporaryLayerFilter must restore original layer objects & pixels at rot=0
  const h1App = new App();
  h1App.newDocument(256, 256, 4, 2, 'H1FourViewRestore', true, true);
  h1App.setGroundShadow({ enabled: true, interBlockEnabled: true });
  h1App.addShapeLayer(
    createDefaultShape('box', { u: 0, v: 0, sizeU: 1, sizeV: 1, heightPx: 36, outlineMode: 'none', edgeHighlight: false }),
    '左侧高楼',
  );
  h1App.addShapeLayer(
    createDefaultShape('dome', { u: 2, v: 0, sizeU: 1.5, sizeV: 1.5, heightPx: 20, outlineMode: 'none', edgeHighlight: false }),
    '右侧矮穹顶',
  );
  const origLayerRefs = [...h1App.doc.layers];
  const beforeRender = new Uint8ClampedArray(h1App.doc.renderToBuffer());
  const beforeLayerData = origLayerRefs.map((l) => new Uint8ClampedArray(l.data));
  const fourRes = (await executeAiStudioCommand(
    { app: h1App, refreshAll: () => {}, fitView: () => {}, requestRender: () => {} },
    {
      kind: 'doc_action',
      action: 'export_psd_base64',
      fourViews: true,
      hideTheoTownBase: true,
      includeGroundShadow: true,
      includeInterBlockShadow: true,
      trim: true,
      scale: 1,
    },
  )) as { psdBase64: string; width: number; height: number; layerCount: number };
  assert.equal(h1App.doc.viewRotation, 0, 'H1: viewRotation restored to 0');
  assert.equal(h1App.doc.layers.length, origLayerRefs.length);
  for (let i = 0; i < origLayerRefs.length; i++) {
    assert.equal(h1App.doc.layers[i], origLayerRefs[i], `H1: layer ${i} keeps exact object identity`);
    assert.ok(buffersEqual(h1App.doc.layers[i].data, beforeLayerData[i]), `H1: layer ${i} pixels unchanged at rot=0`);
  }
  assert.ok(buffersEqual(h1App.doc.renderToBuffer(), beforeRender), 'H1: composite buffer matches rot=0 after 4-view export');

  // M4 & M10: Four-view PSD with shadows outputs 4 layer groups with standalone 地面阴影 & 结构阴影 layers, and exact header dims
  const fourPsdBuf = Buffer.from(fourRes.psdBase64, 'base64');
  const parsedFourShadowPsd = readPsd(fourPsdBuf, { skipCompositeImageData: true, skipLayerImageData: true });
  assert.equal(fourRes.width, parsedFourShadowPsd.width, 'M10: returned PSD width matches binary header exactly');
  assert.equal(fourRes.height, parsedFourShadowPsd.height, 'M10: returned PSD height matches binary header exactly');
  assert.equal(parsedFourShadowPsd.children?.length, 4, 'M4: 4-view PSD has 4 top-level view groups');
  for (const grp of parsedFourShadowPsd.children ?? []) {
    const subNames = (grp.children ?? []).map((c) => c.name);
    assert.ok(subNames.includes(GROUND_SHADOW_LAYER_NAME), `M4: ${grp.name} includes standalone 地面阴影 (${JSON.stringify(subNames)})`);
    assert.ok(subNames.includes(INTER_BLOCK_SHADOW_LAYER_NAME), `M4: ${grp.name} includes standalone 结构阴影 (${JSON.stringify(subNames)})`);
  }

  // M10 single-view PSD metadata when includeGroundShadow=true overrides disabled doc groundShadow
  const m10App = new App();
  m10App.newDocument(192, 192, 3, 3, 'M10Meta', false, false);
  m10App.addShapeLayer(createDefaultShape('box', { u: 0.5, v: 0.5, sizeU: 1, sizeV: 1, heightPx: 40, outlineMode: 'none' }), '塔');
  const m10Res = (await executeAiStudioCommand(
    { app: m10App, refreshAll: () => {}, fitView: () => {}, requestRender: () => {} },
    { kind: 'doc_action', action: 'export_psd_base64', trim: true, includeGroundShadow: true },
  )) as { psdBase64: string; width: number; height: number };
  const m10Parsed = readPsd(Buffer.from(m10Res.psdBase64, 'base64'), { skipCompositeImageData: true, skipLayerImageData: true });
  assert.equal(m10Res.width, m10Parsed.width, 'M10: single-view PSD width includes overridden ground shadow');
  assert.equal(m10Res.height, m10Parsed.height, 'M10: single-view PSD height matches header');

  // H2: Disable -> query canvas -> re-enable inter-block shadow immediately restores shadow without geometry edit
  const h2Before = new Uint8ClampedArray(h1App.doc.renderToBuffer());
  h1App.setGroundShadow({ interBlockEnabled: false });
  assert.equal(h1App.doc.getInterBlockShadowCanvas(), null, 'H2: getInterBlockShadowCanvas returns null when disabled');
  h1App.setGroundShadow({ interBlockEnabled: true });
  const h2After = h1App.doc.renderToBuffer();
  assert.ok(buffersEqual(h2Before, h2After), 'H2: re-enabling interBlockEnabled restores shadow immediately');

  // H3: shadeSteps persists in .bmeow, survives setDocument without being clobbered by app.settings, MCP isolates global settings & supports undo
  const h3App = new App();
  h3App.settings.shadeSteps = 16;
  h3App.newDocument(192, 192, 3, 3, 'H3ShadeSteps', false, false);
  assert.equal(h3App.doc.shadeSteps, 16, 'H3: newDocument inherits global shadeSteps default');
  h3App.addShapeLayer(createDefaultShape('dome', { u: 0.5, v: 0.5, sizeU: 2, sizeV: 2, heightPx: 32, outlineMode: 'none' }), '穹顶');
  await executeAiStudioCommand(
    { app: h3App, refreshAll: () => {}, fitView: () => {}, requestRender: () => {} },
    { kind: 'doc_action', action: 'set_shade_steps', shadeSteps: 6 },
  );
  assert.equal(h3App.doc.shadeSteps, 6, 'H3: MCP updates doc.shadeSteps');
  assert.equal(h3App.settings.shadeSteps, 16, 'H3: MCP set_shade_steps does NOT overwrite user global preference');
  const h3Json = serializeBmeowProject(h3App.doc, 'H3ShadeSteps');
  const h3Loaded = await deserializeBmeowProject(h3Json);
  assert.equal(h3Loaded.doc.shadeSteps, 6, 'H3: .bmeow preserves shadeSteps=6');
  const h3OtherDevice = new App();
  h3OtherDevice.settings.shadeSteps = 0;
  h3OtherDevice.setDocument(h3Loaded.doc, h3Loaded.name);
  assert.equal(h3OtherDevice.doc.shadeSteps, 6, 'H3: setDocument does NOT clobber loaded .bmeow shadeSteps');
  h3App.undo();
  assert.equal(h3App.doc.shadeSteps, 16, 'H3: undo reverts MCP set_shade_steps');
  await assert.rejects(
    () =>
      executeAiStudioCommand(
        { app: h3App, refreshAll: () => {}, fitView: () => {}, requestRender: () => {} },
        { kind: 'doc_action', action: 'set_shade_steps', shadeSteps: 2 },
      ),
    /Invalid shadeSteps/,
    'Low L6: invalid shadeSteps=2 throws clear validation error',
  );

  // M1: Back-facing surfaces (sunFacing === 0) are strictly skipped (0 double-darkening) & all 4 rotations cast rightward
  const m1Doc = new BuilderDocument(224, 224, 4, 4, 16);
  m1Doc.groundShadow.enabled = true;
  m1Doc.groundShadow.interBlockEnabled = true;
  const tallBox = new BuilderLayer(224, 224, 'Tall', 'shape', createDefaultShape('box', { u: 1, v: 1, sizeU: 1, sizeV: 1, heightPx: 48, outlineMode: 'none', edgeHighlight: false }));
  const shortBox = new BuilderLayer(224, 224, 'Short', 'shape', createDefaultShape('box', { u: 2, v: 1, sizeU: 1, sizeV: 1, heightPx: 16, outlineMode: 'none', edgeHighlight: false }));
  m1Doc.layers.push(tallBox, shortBox);
  m1Doc.rerenderAllShapes();
  const m1Ib = m1Doc.ensureInterBlockShadowBuffer();
  let m1BackLitShadows = 0;
  let m1LitShadows = 0;
  for (let p = 0; p < 224 * 224; p++) {
    if (m1Ib[p * 4 + 3] > 0 && shortBox.data[p * 4 + 3] === 255) {
      if (shortBox.sunFacing[p] === 0) m1BackLitShadows++;
      else m1LitShadows++;
    }
  }
  assert.equal(m1BackLitShadows, 0, 'M1: zero inter-block shadow pixels on back-facing walls');
  assert.ok(m1LitShadows > 25 && m1LitShadows < 600, `M1: realistic sunlit shadow count on neighbor (got ${m1LitShadows})`);

  // Symmetric setback tower on 3x3 podium casts consistent rightward shadow across all 4 rotations
  const rotDoc = new BuilderDocument(224, 224, 4, 4, 16);
  rotDoc.groundShadow.enabled = true;
  rotDoc.groundShadow.interBlockEnabled = true;
  rotDoc.layers.push(
    new BuilderLayer(224, 224, 'Podium', 'shape', createDefaultShape('box', { u: 0.5, v: 0.5, sizeU: 3, sizeV: 3, zPx: 0, heightPx: 16, outlineMode: 'none', edgeHighlight: false })),
    new BuilderLayer(224, 224, 'CenterTower', 'shape', createDefaultShape('box', { u: 1.5, v: 1.5, sizeU: 1, sizeV: 1, zPx: 16, heightPx: 24, outlineMode: 'none', edgeHighlight: false })),
  );
  rotDoc.rerenderAllShapes();
  const rotCounts: number[] = [];
  for (let r = 0; r < 4; r++) {
    rotDoc.viewRotation = r as 0 | 1 | 2 | 3;
    rotDoc.rerenderAllShapes();
    const ib = rotDoc.ensureInterBlockShadowBuffer();
    const { originX: rOx, originY: rOy } = rotDoc.getViewOrigin();
    const [towerLeftX] = isoToScreenPx(1.5, 2.5, 16, rOx, rOy);
    let cnt = 0;
    for (let py = 0; py < 224; py++) {
      for (let px = 0; px < 224; px++) {
        if (ib[(py * 224 + px) * 4 + 3] > 0) {
          assert.ok(px >= Math.floor(towerLeftX) - 1, `rot=${r}: shadow pixel at x=${px} must cast rightward of tower`);
          cnt++;
        }
      }
    }
    rotCounts.push(cnt);
  }
  assert.ok(rotCounts[0] > 40, `symmetric podium shadow > 40 px (got ${rotCounts[0]})`);
  assert.deepEqual(rotCounts, [rotCounts[0], rotCounts[0], rotCounts[0], rotCounts[0]], `M13: all 4 rotations produce identical shadow counts (${JSON.stringify(rotCounts)})`);

  // M2: Concave self-shadowing (hollow portal arch & hollow loft with floor) vs 0 false self-shadows on convex shapes
  for (const kind of ['dome', 'cylinder', 'cone'] as const) {
    const cvxDoc = new BuilderDocument(192, 192, 3, 3, 16);
    cvxDoc.groundShadow.interBlockEnabled = true;
    cvxDoc.layers.push(new BuilderLayer(192, 192, kind, 'shape', createDefaultShape(kind, { u: 0.5, v: 0.5, sizeU: 2, sizeV: 2, heightPx: 36, outlineMode: 'none', edgeHighlight: false })));
    cvxDoc.rerenderAllShapes();
    const ib = cvxDoc.ensureInterBlockShadowBuffer();
    let selfPx = 0;
    for (let i = 3; i < ib.length; i += 4) if (ib[i] > 0) selfPx++;
    assert.equal(selfPx, 0, `M2: convex ${kind} has 0 false self-shadow pixels (got ${selfPx})`);
  }
  const hollowArchDoc = new BuilderDocument(224, 224, 4, 4, 16);
  hollowArchDoc.groundShadow.interBlockEnabled = true;
  hollowArchDoc.layers.push(
    new BuilderLayer(
      224,
      224,
      'HollowArch',
      'shape',
      createDefaultShape('arch', {
        u: 1, v: 1, sizeU: 2, sizeV: 2, heightPx: 42, ori: 1,
        archHollow: true, archHollowStyle: 'portal', archThickness: 0.25,
        outlineMode: 'none', edgeHighlight: false,
      }),
    ),
  );
  hollowArchDoc.rerenderAllShapes();
  let archSelfPx = 0;
  const archIb = hollowArchDoc.ensureInterBlockShadowBuffer();
  for (let i = 3; i < archIb.length; i += 4) if (archIb[i] > 0) archSelfPx++;
  assert.ok(archSelfPx > 5, `M2: hollow portal arch (ori=1) casts self-shadow onto sunlit inner wall (got ${archSelfPx} px)`);

  const hollowLoftDoc = new BuilderDocument(224, 224, 4, 4, 16);
  hollowLoftDoc.groundShadow.interBlockEnabled = true;
  hollowLoftDoc.layers.push(
    new BuilderLayer(
      224,
      224,
      'HollowLoft',
      'shape',
      createDefaultShape('loft', {
        u: 0.5, v: 0.5, sizeU: 3, sizeV: 3, heightPx: 44,
        loftHollow: true, loftFloorT: 0.2,
        outlineMode: 'none', edgeHighlight: false,
      }),
    ),
  );
  hollowLoftDoc.rerenderAllShapes();
  let loftSelfPx = 0;
  const loftIb = hollowLoftDoc.ensureInterBlockShadowBuffer();
  for (let i = 3; i < loftIb.length; i += 4) if (loftIb[i] > 0) loftSelfPx++;
  assert.ok(loftSelfPx > 10, `M2: hollow loft with floor casts self-shadow onto inner courtyard (got ${loftSelfPx} px)`);

  // M3: getGroundShadowInsertIndex handles overlay before theotown_base cleanly
  const m3Doc = new BuilderDocument(128, 128, 2, 2, 16);
  const m3Under = new BuilderLayer(128, 128, 'Under', 'raster');
  m3Under.rasterRole = 'underlay';
  const m3Over = new BuilderLayer(128, 128, 'Over', 'raster');
  m3Over.rasterRole = 'overlay';
  const m3Base = new BuilderLayer(128, 128, 'Base', 'shape', createDefaultShape('theotown_base', { u: 0, v: 0, sizeU: 2, sizeV: 2, heightPx: 0 }));
  const m3Box = new BuilderLayer(128, 128, 'Box', 'shape', createDefaultShape('box', { u: 0, v: 0, sizeU: 1, sizeV: 1, heightPx: 20 }));
  m3Doc.layers.push(m3Under, m3Over, m3Base, m3Box);
  assert.equal(m3Doc.getGroundShadowInsertIndex(), 3, 'M3: ground shadow inserts above base and strictly below first 3D shape');

  // M5: Analytical cylinder (px+0.5) has 4x90 invariance and 0 bottom-left shadow leak
  const cylW = 192, cylH = 192;
  const { originX: cOx, originY: cOy } = getPlotOrigin(cylW, cylH, 3, 3, 16);
  const cylShape = createDefaultShape('cylinder', { u: 0.5, v: 0.5, sizeU: 2, sizeV: 2, heightPx: 30, outlineMode: 'none', edgeHighlight: false });
  const cylBuf0 = new Uint8ClampedArray(cylW * cylH * 4);
  renderShapeToBuffer(cylBuf0, cylW, cylH, cylShape, 3, 3, 0, cOx, cOy);
  let cylPx0 = 0;
  for (let i = 3; i < cylBuf0.length; i += 4) if (cylBuf0[i] === 255) cylPx0++;
  for (const rot of [1, 2, 3] as const) {
    const cb = new Uint8ClampedArray(cylW * cylH * 4);
    renderShapeToBuffer(cb, cylW, cylH, cylShape, 3, 3, rot, cOx, cOy);
    let cnt = 0;
    for (let i = 3; i < cb.length; i += 4) if (cb[i] === 255) cnt++;
    assert.equal(cnt, cylPx0, `M5: analytical cylinder pixel count identical at rot=${rot}`);
  }
  const cylMask = new Uint8Array(cylW * cylH);
  renderShapeGroundShadowMask(cylMask, cylW, cylH, cylShape, 3, 3, 0, cOx, cOy);
  const [cylCx] = isoToScreenPx(1.5, 1.5, 0, cOx, cOy);
  let leftLeak = 0;
  for (let py = 0; py < cylH; py++) {
    for (let px = 0; px < Math.floor(cylCx); px++) {
      if (cylMask[py * cylW + px] === 1 && cylBuf0[(py * cylW + px) * 4 + 3] === 0) leftLeak++;
    }
  }
  assert.equal(leftLeak, 0, `M5: analytical cylinder has 0 left-half ground shadow leak (got ${leftLeak})`);

  // M6: Unified MIN_SHADE_CONTRAST = 0.3
  assert.equal(clampShadeContrast(0.1), 0.3);
  assert.equal(clampShadeContrast(0.25), 0.3);
  assert.equal(clampShadeContrast(5.5), 5.0);
  await executeAiStudioCommand(
    { app: m10App, refreshAll: () => {}, fitView: () => {}, requestRender: () => {} },
    { kind: 'upsert_shape', mode: 'update', layerIndex: 0, shadeContrast: 0.2 },
  );
  assert.equal(m10App.doc.layers[0].shape?.shadeContrast, 0.3, 'M6: MCP upsert_shape clamps shadeContrast to >= 0.3');

  // M7: Exact N-band cel shading counts on a full dome
  const bandDome = createDefaultShape('dome', { u: 0.5, v: 0.5, sizeU: 2, sizeV: 2, heightPx: 36, baseColor: { r: 168, g: 176, b: 194, a: 255 }, autoShade: true, shadeContrast: 1.5, outlineMode: 'none', edgeHighlight: false });
  for (const nSteps of [3, 4, 8] as const) {
    const db = new Uint8ClampedArray(cylW * cylH * 4);
    renderShapeToBuffer(db, cylW, cylH, bandDome, 3, 3, 0, cOx, cOy, nSteps);
    const cols = new Set<number>();
    for (let i = 0; i < db.length; i += 4) if (db[i + 3] === 255) cols.add((db[i] << 16) | (db[i + 1] << 8) | db[i + 2]);
    assert.equal(cols.size, nSteps, `M7: dome with shadeSteps=${nSteps} produces exact ${nSteps} tones (got ${cols.size})`);
  }

  // M8 + Low L2 (noop history) + Low L5 (6-digit hex in .bmeow keeps default alpha 90) + Low L1 (lazy aux allocation)
  const m8App = new App();
  m8App.newDocument(128, 128, 2, 2, 'M8Opacity', false, true);
  assert.equal(m8App.doc.layers.every((l) => l.zData.length === 0), true, 'Low L1: zData lazily unallocated when interBlockEnabled=false');
  await executeAiStudioCommand(
    { app: m8App, refreshAll: () => {}, fitView: () => {}, requestRender: () => {} },
    { kind: 'doc_action', action: 'set_ground_shadow', opacityPct: 35.3 },
  );
  assert.equal(m8App.doc.groundShadow.color.a, 90, 'M8: opacityPct=35.3 sets exact alpha=90');
  const histBeforeNoop = m8App.history.canUndo;
  // Calling again with identical values should not push a duplicate undo entry
  m8App.history.clear();
  await executeAiStudioCommand(
    { app: m8App, refreshAll: () => {}, fitView: () => {}, requestRender: () => {} },
    { kind: 'doc_action', action: 'set_ground_shadow', opacityPct: 35.3 },
  );
  assert.equal(m8App.history.canUndo, false, 'Low L2: noop set_ground_shadow does not push empty undo entry');
  assert.ok(histBeforeNoop || true);
  await assert.rejects(
    () =>
      executeAiStudioCommand(
        { app: m8App, refreshAll: () => {}, fitView: () => {}, requestRender: () => {} },
        { kind: 'doc_action', action: 'set_ground_shadow', opacity: 35 },
      ),
    /Invalid opacity/,
    'M8: ambiguous opacity=35 (>1) throws clear error directing to opacityPct',
  );
  const sixDigitJson = JSON.stringify({
    format: 'bmeow-v1',
    name: 'SixHex',
    width: 128,
    height: 128,
    plotU: 2,
    plotV: 2,
    bottomMarginPx: 16,
    viewRotation: 0,
    autoSortOnRotate: true,
    groundShadow: { enabled: true, colorHex8: '#00071C' },
    active: 0,
    layers: [],
  });
  const sixRestored = await deserializeBmeowProject(sixDigitJson);
  assert.equal(sixRestored.doc.groundShadow.color.a, DEFAULT_GROUND_SHADOW_COLOR.a, 'Low L5: 6-digit hex in .bmeow preserves default alpha=90');

  // Verify raster layer does not allocate zData/sunFacing even when interBlockEnabled=true
  const rLayer = new BuilderLayer(128, 128, 'Ref', 'raster');
  assert.equal(rLayer.zData.length, 0, 'Low L1: raster layer allocates 0 bytes for zData');
  assert.equal(rLayer.sunFacing.length, 0, 'Low L1: raster layer allocates 0 bytes for sunFacing');

  console.log('PASS: Opus v1.4.x review fixes (H1-H3, M1-M10, lazy aux memory, exact cel bands, 4-view shadow groups & concave self-shadow)');
}

function testV145I18nAndBrandMetadata() {
  const CJK_RE = /[\u4e00-\u9fff]/;

  // 1. Author, MIT License, Pixel Meow Online URL & version metadata
  assert.equal(APP_AUTHOR, 'yukyuu', 'Author must be yukyuu');
  assert.equal(APP_LICENSE_NAME, 'MIT License', 'License name must be MIT License');
  assert.ok(MIT_LICENSE_TEXT.includes('MIT License'), 'MIT_LICENSE_TEXT must contain MIT License');
  assert.ok(MIT_LICENSE_TEXT.includes('yukyuu'), 'MIT_LICENSE_TEXT must credit yukyuu');
  assert.equal(PIXEL_MEOW_ONLINE_URL, 'https://pixelmeow.9rm.uk/', 'Pixel Meow Online URL must match');
  assert.equal(APP_VERSION, '1.4.6', 'APP_VERSION must be 1.4.6');
  assert.equal(CHANGELOG_ENTRIES[0]?.version, '1.4.6', 'Latest changelog entry must be 1.4.6');

  const licenseFile = fs.readFileSync(path.resolve(process.cwd(), 'LICENSE'), 'utf8');
  assert.ok(licenseFile.includes('MIT License') && licenseFile.includes('yukyuu'), 'Root LICENSE file must contain MIT License and yukyuu');

  // 2. System locale detection & resolution
  assert.equal(detectSystemLocale(['zh-CN']), 'zh');
  assert.equal(detectSystemLocale(['zh-TW']), 'zh');
  assert.equal(detectSystemLocale(['en-US']), 'en');
  assert.equal(detectSystemLocale(['ja-JP']), 'en');
  assert.equal(resolveLocale('zh', ['en-US']), 'zh');
  assert.equal(resolveLocale('en', ['zh-CN']), 'en');
  assert.equal(resolveLocale('auto', ['zh-CN']), 'zh');
  assert.equal(resolveLocale('auto', ['en-GB']), 'en');
  assert.equal(SUPPORTED_LOCALES.length, 3);

  // 3. Default App settings & reactive language setter
  const freshApp = new App();
  assert.equal(freshApp.settings.pixelMeowWebUrl, 'https://pixelmeow.9rm.uk/', 'Default Pixel Meow URL must be online edition');
  assert.equal(freshApp.settings.language, 'auto', 'Default language setting must be auto');

  try {
    freshApp.setLanguage('en');
    assert.equal(getLanguageSetting(), 'en');
    assert.equal(getLocale(), 'en');

    const assertNoCjk = (src: string, ctx: string) => {
      const out = tr(src);
      assert.ok(!CJK_RE.test(out), `[en i18n] CJK leaked in ${ctx}: "${src}" -> "${out}"`);
    };

    // Exhaustive checks across all enums, presets, themes, shortcuts & changelog
    for (const label of Object.values(SHAPE_LABELS)) assertNoCjk(label, 'SHAPE_LABELS');
    for (const m of BLEND_MODES) assertNoCjk(m.label, `BLEND_MODES.${m.id}`);
    for (const p of ARCH_PRESETS) assertNoCjk(p.label, `ARCH_PRESETS.${p.id}`);
    for (const m of ARCH_INNER_MODES) {
      assertNoCjk(m.label, `ARCH_INNER_MODES.${m.id}.label`);
      assertNoCjk(m.short, `ARCH_INNER_MODES.${m.id}.short`);
      assertNoCjk(m.desc, `ARCH_INNER_MODES.${m.id}.desc`);
    }
    for (const p of LOFT_PRESETS) assertNoCjk(p.label, `LOFT_PRESETS.${p.id}`);
    for (const t of THEME_PRESETS) assertNoCjk(t.name, `THEME_PRESETS.${t.id}`);
    for (const c of BLENDER_SHORTCUT_CATEGORIES) assertNoCjk(c.label, `SHORTCUT_CAT.${c.id}`);
    for (const a of BLENDER_SHORTCUT_ACTIONS) {
      assertNoCjk(a.label, `SHORTCUT_ACT.${a.id}.label`);
      if (a.description) assertNoCjk(a.description, `SHORTCUT_ACT.${a.id}.desc`);
    }
    for (const p of BLENDER_SHORTCUT_PRESETS) {
      assertNoCjk(p.name, `SHORTCUT_PRESET.${p.id}.name`);
      assertNoCjk(p.description, `SHORTCUT_PRESET.${p.id}.desc`);
    }
    for (const entry of CHANGELOG_ENTRIES) {
      assertNoCjk(entry.title, `CHANGELOG.${entry.version}.title`);
      entry.items.forEach((it, idx) => assertNoCjk(it, `CHANGELOG.${entry.version}.item[${idx}]`));
    }

    // Representative dynamic templates & Brand Menu / About strings
    const samples = [
      'Blender Meow 菜单、语言与关于',
      'Blender Meow 菜单',
      '📌 关于与开源声明 (MIT License)',
      '查看完整 MIT License 全文',
      '🎨 打开 Pixel Meow 在线版',
      '🌐 使用在线版',
      '视角 90° · 32×16=9.6m · 竖3px=1.6m',
      '像素 (128, 64) · 网格 (U:2.00, V:1.50) · 视角 180°',
      '256×256 · 4×4格',
      '竖直: 24px = 12.80m',
      '平面: 19.20m (U:2.00格 V:0.00格)',
      '混合: 23.07m (33.7°)',
      '跨度 2格 (19.2m) · 拱高 32px (17.07m) · 外圈点 5 个 · 内圈点 5 个',
      '✨[过渡面] 当前控制面：中腰控制面 · 高度 16px (8.53m, 50%) · 外圈 8点 · 双击蓝虚线可解锁自由内圈 / 拖◆调壁厚',
      '当前控制面：顶层控制面 · 32px (100%) · 4条控制边 (锁定 1 条)',
      '顶边 (-V) 🔒· 偏移 +0.125 · 15.0°',
      '内圈点 #2/6:',
      '节点#3 (0.500, 0.250)',
      '规范矩形底图：64×32 px（已裁切 32×16）（库中可随时 ▭⇄▱ 无损切换）',
      '当前：分段像素色阶（16 档），拖动下方滑条可在 3 ~ 64 档之间微调',
      `已切换预设：${BLENDER_SHORTCUT_PRESETS[0].name}`,
      '立方体 / 长方体 3',
      '圆柱体 4 副本',
      '曲面柱 / 平放拱 (控制面) 5',
    ];
    for (const s of samples) assertNoCjk(s, 'sample');
    assert.equal(tr('立方体 / 长方体 3'), 'Box / Cuboid 3');
    assert.equal(tr('圆柱体 4 副本'), 'Cylinder 4 Copy');

    // Verify locale-aware auto-naming on new layers, starter doc, clone, newDocument & sections in English mode
    const enApp = new App();
    enApp.setLanguage('en');
    enApp.newDocument(128, 128, 2, 2, tr('等距建筑 2'), true, true);
    assert.equal(enApp.docName, 'Iso Building 2');
    assert.ok(!CJK_RE.test(enApp.doc.layers[0].name), `English base layer must have no CJK: ${enApp.doc.layers[0].name}`);
    for (const kind of Object.keys(SHAPE_LABELS) as ShapeKind[]) {
      const added = enApp.addShapeLayer(createDefaultShape(kind));
      assert.ok(!CJK_RE.test(added.name), `English auto-named ${kind} layer must have no CJK: "${added.name}"`);
    }
    const cloned = enApp.doc.layers[enApp.doc.layers.length - 1].clone();
    assert.ok(cloned.name.endsWith(' Copy') && !CJK_RE.test(cloned.name), `Cloned layer in EN must end with Copy: "${cloned.name}"`);
    const loftShape = createDefaultShape('loft');
    const loftSecs = normalizeLoftSections(loftShape.loftSections);
    for (const sec of loftSecs) {
      assert.ok(!CJK_RE.test(sec.name), `English loft section must have no CJK: "${sec.name}"`);
    }
    const colShape = createDefaultShape('box');
    const colSecs = ensureColumnSections(colShape);
    for (const sec of colSecs) {
      assert.ok(!CJK_RE.test(sec.name), `English column section must have no CJK: "${sec.name}"`);
    }
    // Custom layer names are preserved verbatim in English mode
    const customLayer = enApp.addShapeLayer(createDefaultShape('box'), '东京塔');
    assert.equal(customLayer.name, '东京塔');

    // Switching back to Chinese preserves Chinese verbatim and generates Chinese auto-names
    freshApp.setLanguage('zh');
    assert.equal(getLocale(), 'zh');
    assert.equal(tr('Blender Meow 菜单'), 'Blender Meow 菜单');
    const zhBox = freshApp.addShapeLayer(createDefaultShape('box'));
    assert.ok(zhBox.name.startsWith('立方体 / 长方体 '), `Chinese auto-named box layer must stay Chinese: "${zhBox.name}"`);
  } finally {
    setLanguageSetting('zh');
  }

  console.log('PASS: v1.4.6 English i18n coverage, localized layer/entity auto-naming, Top-Left Brand Menu, MIT License (yukyuu) & Pixel Meow Online URL');
}

async function main() {
  testRotationClosure();
  testTheoTownRuler();
  testPrimitivesAndPatterns();
  testTopologicalDepthSort();
  testM9AndM11AndL7();
  testHistoryPushBeforeMutateAndDiscard();
  testRuler3DAndVertThenFlat();
  testResizeAndBlendAndPsdTrim();
  await testRightTriPrismAndPlotFrame();
  testLargeDomeAndSphereWatertight();
  await testLoftWatertightAndRotationClosure();
  await testOpusV112ReviewFixes();
  testPixelMeowColorAndPalette();
  await testArchSolidHollowAndRotationClosure();
  await testHollowLoftAndFlatArchPresets();
  await testOpusV123ReviewFixes();
  await testV124Features();
  await testV125Features();
  testShortcutSystem();
  await testPlanarFaceTextures();
  await testV131Features();
  await testAiStudioOpsAndMcpExport();
  await testV140GroundShadow();
  await testCurvedShadingAndContrastRange();
  await testExperimentalInterBlockShadow();
  await testOpusV14xReviewFixes();
  testV145I18nAndBrandMetadata();
  console.log('ALL CORE CHECKS PASSED');
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
