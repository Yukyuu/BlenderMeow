// Standalone, zero-dependency Shortcut Preset & Custom Keybinding Editor UI
import { tr } from '../core/i18n';
import { h } from '../ui/dom';
import { eventToKeyStroke, formatKeyStroke } from './keyCodec';
import type { ShortcutManager } from './shortcutManager';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  return h(tag, attrs, ...children);
}

export interface ShortcutEditorUIOptions {
  onToast?: (msg: string) => void;
}

export function createShortcutEditorUI(
  manager: ShortcutManager,
  opts: ShortcutEditorUIOptions = {},
): { el: HTMLElement; refresh: () => void; dispose: () => void } {
  const root = el('div', { class: 'sc-editor' });

  let recordingTarget: { actionId: string; slotIndex: 0 | 1 } | null = null;
  let searchQuery = '';

  const presetSel = el('select', { class: 'select', title: '选择内置键盘预设方案' }) as HTMLSelectElement;
  const resetPresetBtn = el('button', {
    class: 'btn small',
    type: 'button',
    title: '恢复当前预设（或推荐预设）的默认键位绑定',
  }, '↺ 恢复默认');
  const exportBtn = el('button', {
    class: 'btn small',
    type: 'button',
    title: '导出键盘配置 JSON（可用于备份或同步导入到 Pixel Meow）',
  }, '📤 导出配置');
  const importBtn = el('button', {
    class: 'btn small',
    type: 'button',
    title: '导入保存的 JSON 键盘配置（兼容 Blender Meow 与 Pixel Meow 通用键位）',
  }, '📥 导入配置');
  const fileIn = el('input', {
    type: 'file',
    accept: '.json,application/json',
    style: 'display:none',
  }) as HTMLInputElement;
  const presetDescEl = el('div', { class: 'hint', style: 'margin-top:-2px' });

  const searchIn = el('input', {
    type: 'search',
    class: 'text-input sc-search',
    placeholder: '🔍 搜索操作名称或按键（如：画布、撤回、微调、Space、Arrow）...',
  }) as HTMLInputElement;

  const listWrap = el('div', { class: 'sc-list' });

  const stopRecording = () => {
    if (!recordingTarget) return;
    recordingTarget = null;
    manager.setRecording(false);
    window.removeEventListener('keydown', onCaptureRecord, true);
  };

  const onCaptureRecord = (e: KeyboardEvent) => {
    if (!recordingTarget) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

    if (e.isComposing || e.keyCode === 229) return;
    if (e.code === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      stopRecording();
      renderList();
      return;
    }
    if (e.code === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const { actionId, slotIndex } = recordingTarget;
      stopRecording();
      manager.setSlotBinding(actionId, slotIndex, null);
      opts.onToast?.('已清空该槽位按键绑定');
      refresh();
      return;
    }

    const stroke = eventToKeyStroke(e);
    if (!stroke) return; // Wait for non-modifier key

    const { actionId, slotIndex } = recordingTarget;
    stopRecording();
    const { unboundFrom } = manager.setSlotBinding(actionId, slotIndex, stroke);
    const keyLabel = formatKeyStroke(stroke);
    if (unboundFrom.length > 0) {
      const names = unboundFrom.map((a) => `「${a.label}」`).join('、');
      opts.onToast?.(`已绑定 ${keyLabel}，并自动解除原冲突项 ${names}`);
    } else {
      opts.onToast?.(`已绑定 ${keyLabel}`);
    }
    refresh();
  };

  const startRecording = (actionId: string, slotIndex: 0 | 1) => {
    stopRecording();
    recordingTarget = { actionId, slotIndex };
    manager.setRecording(true);
    window.addEventListener('keydown', onCaptureRecord, true);
    renderList();
  };

  const syncPresetBar = () => {
    presetSel.innerHTML = '';
    const presets = manager.getPresets();
    const activeId = manager.getActivePresetId();
    for (const p of presets) {
      const opt = el('option', { value: p.id, selected: p.id === activeId }, p.name);
      presetSel.append(opt);
    }
    if (activeId === 'custom') {
      presetSel.append(el('option', { value: 'custom', selected: true }, '✨ 自定义修改方案 (基于预设)'));
    }
    const found = presets.find((p) => p.id === activeId);
    presetDescEl.textContent = tr(
      found
        ? found.description
        : '当前为自定义键位布局；点击任意按键槽位可重新录制，按 Esc 取消，按 Backspace 清空槽位。',
    );
  };

  const renderList = () => {
    listWrap.innerHTML = '';
    const q = searchQuery.trim().toLowerCase();

    let totalShown = 0;
    for (const cat of manager.categories) {
      const acts = manager.actions.filter((a) => a.category === cat.id);
      const matched = acts.filter((a) => {
        if (!q) return true;
        const bindingsText = manager.getBindings(a.id).map((ks) => formatKeyStroke(ks).toLowerCase()).join(' ');
        const codesText = manager.getBindings(a.id).map((ks) => ks.code.toLowerCase()).join(' ');
        return (
          a.label.toLowerCase().includes(q) ||
          tr(a.label).toLowerCase().includes(q) ||
          (a.description ?? '').toLowerCase().includes(q) ||
          tr(a.description ?? '').toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q) ||
          bindingsText.includes(q) ||
          codesText.includes(q)
        );
      });
      if (matched.length === 0) continue;
      totalShown += matched.length;

      listWrap.append(
        el('div', { class: 'sc-cat-title' }, cat.icon ? `${cat.icon} ${cat.label}` : cat.label),
      );

      for (const act of matched) {
        const list = manager.getBindings(act.id);
        const modified = manager.isActionModified(act.id);

        const makeSlotPill = (slotIdx: 0 | 1) => {
          const isRec = recordingTarget?.actionId === act.id && recordingTarget?.slotIndex === slotIdx;
          const ks = list[slotIdx];
          const text = isRec
            ? '按下按键… (Esc取消 / ⌫清空)'
            : ks
              ? formatKeyStroke(ks)
              : slotIdx === 0
                ? '未绑定（点击设置）'
                : '+ 备用键';
          const pill = el(
            'button',
            {
              type: 'button',
              class: `sc-key-pill${isRec ? ' recording' : !ks ? ' empty' : ''}`,
              title: isRec
                ? '请按下目标快捷键组合；Esc 取消，Backspace 清空'
                : `点击设置「${act.label}」${slotIdx === 0 ? '主键位' : '备用键位'}`,
            },
            text,
          );
          pill.addEventListener('click', () => {
            if (isRec) {
              stopRecording();
              renderList();
            } else {
              startRecording(act.id, slotIdx);
            }
          });
          return pill;
        };

        const resetRowBtn = el(
          'button',
          {
            type: 'button',
            class: 'btn small',
            style: modified ? 'padding:2px 6px' : 'padding:2px 6px;visibility:hidden',
            title: '恢复此项默认绑定',
          },
          '↺',
        );
        resetRowBtn.addEventListener('click', () => {
          stopRecording();
          manager.resetAction(act.id);
          opts.onToast?.(`已恢复「${act.label}」默认键位`);
          refresh();
        });

        listWrap.append(
          el(
            'div',
            { class: 'sc-row' },
            el(
              'div',
              { class: 'sc-meta' },
              el('div', { class: 'sc-label' }, act.label),
              act.description ? el('div', { class: 'hint' }, act.description) : null,
            ),
            el(
              'div',
              { class: 'sc-slots' },
              makeSlotPill(0),
              makeSlotPill(1),
              resetRowBtn,
            ),
          ),
        );
      }
    }

    if (totalShown === 0) {
      listWrap.append(el('div', { class: 'hint', style: 'text-align:center;padding:16px 0' }, '没有匹配的快捷键项'));
    }
  };

  const refresh = () => {
    syncPresetBar();
    renderList();
  };

  presetSel.addEventListener('change', () => {
    if (presetSel.value === 'custom') return;
    stopRecording();
    manager.applyPreset(presetSel.value);
    opts.onToast?.(`已切换预设：${manager.getActivePresetName()}`);
    refresh();
  });

  resetPresetBtn.addEventListener('click', () => {
    stopRecording();
    manager.resetToPreset();
    opts.onToast?.(`已重置为 ${manager.getActivePresetName()}`);
    refresh();
  });

  exportBtn.addEventListener('click', () => {
    const json = manager.exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${manager.appId}-shortcuts.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    opts.onToast?.(`已导出快捷键配置 ${manager.appId}-shortcuts.json`);
  });

  importBtn.addEventListener('click', () => {
    fileIn.value = '';
    fileIn.click();
  });

  fileIn.addEventListener('change', () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    void f.text().then((txt) => {
      try {
        stopRecording();
        const res = manager.importJson(txt);
        opts.onToast?.(`已成功导入 ${res.importedCount} 项快捷键配置`);
        refresh();
      } catch (err) {
        opts.onToast?.(`导入失败：${err instanceof Error ? err.message : String(err)}`);
      }
    });
  });

  searchIn.addEventListener('input', () => {
    searchQuery = searchIn.value;
    renderList();
  });

  const unsub = manager.onChange(() => {
    if (!root.isConnected) return;
    refresh();
  });

  root.append(
    el(
      'div',
      { class: 'sc-toolbar' },
      el('span', { class: 'rl', style: 'min-width:60px' }, '键盘预设'),
      presetSel,
      resetPresetBtn,
      exportBtn,
      importBtn,
      fileIn,
    ),
    presetDescEl,
    searchIn,
    listWrap,
  );

  refresh();

  return {
    el: root,
    refresh,
    dispose: () => {
      stopRecording();
      unsub();
    },
  };
}
