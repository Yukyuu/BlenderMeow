// Browser / Capacitor IndexedDB persistence store for user-imported TextureAssets.
// Separated from pure pixel core (`textures.ts`) so `isoRenderer.ts` stays platform-free.

import { kvGet, kvSet } from '../platform';
import {
  deserializeTextureAsset,
  getPersistableTextureGroups,
  getPersistableUserTextureAssets,
  hydratePersistedTextureAssets,
  hydratePersistedTextureGroups,
  onTextureLibraryChange,
  serializeTextureAsset,
  type SerializedTextureAsset,
  type TextureGroup,
} from './textures';

const TEXTURES_STORAGE_KEY = 'blendermeow.textures.v1';
const GROUPS_STORAGE_KEY = 'blendermeow.textureGroups.v1';

let autoSaveBound = false;

export async function savePersistedTextureLibrary(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const userAssets: SerializedTextureAsset[] = getPersistableUserTextureAssets().map(serializeTextureAsset);
  const customGroups: TextureGroup[] = getPersistableTextureGroups();
  try {
    await kvSet(GROUPS_STORAGE_KEY, customGroups);
    await kvSet(TEXTURES_STORAGE_KEY, userAssets);
  } catch (e) {
    console.warn('savePersistedTextureLibrary failed', e);
  }
}

export async function loadPersistedTextureLibrary(): Promise<number> {
  if (!autoSaveBound) {
    autoSaveBound = true;
    onTextureLibraryChange((reason) => {
      if (reason === 'pixels' || reason === 'list' || reason === 'display' || reason === 'groups') {
        void savePersistedTextureLibrary();
      }
    });
  }
  if (typeof indexedDB === 'undefined') return 0;
  try {
    const savedGroups = await kvGet<TextureGroup[]>(GROUPS_STORAGE_KEY);
    if (Array.isArray(savedGroups)) {
      hydratePersistedTextureGroups(savedGroups);
    }
    const list = await kvGet<SerializedTextureAsset[]>(TEXTURES_STORAGE_KEY);
    if (!Array.isArray(list)) return 0;
    const loaded = [];
    for (const raw of list) {
      const parsed = await deserializeTextureAsset(raw);
      if (parsed) loaded.push(parsed);
    }
    return hydratePersistedTextureAssets(loaded);
  } catch (e) {
    console.warn('loadPersistedTextureLibrary failed', e);
    return 0;
  }
}
