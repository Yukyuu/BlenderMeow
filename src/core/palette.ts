// Palettes: built-in + user saved palettes (localStorage) — ported from Pixel Meow
import { clamp, toHex } from './color';

export interface Palette {
  id: string;
  name: string;
  colors: string[];
  builtin?: boolean;
}

export const BUILTIN_PALETTES: Palette[] = [
  {
    id: 'pico8',
    name: 'PICO-8 (16)',
    builtin: true,
    colors: [
      '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
      '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
    ],
  },
  {
    id: 'sweetie16',
    name: 'Sweetie 16',
    builtin: true,
    colors: [
      '#1A1C2C', '#5D275D', '#B13E53', '#EF7D57', '#FFCD75', '#A7F070', '#38B764', '#257179',
      '#29366F', '#3B5DC9', '#41A6F6', '#73EFF7', '#F4F4F4', '#94B0C2', '#566C86', '#333C57',
    ],
  },
  {
    id: 'db16',
    name: 'DawnBringer 16',
    builtin: true,
    colors: [
      '#140C1C', '#442434', '#30346D', '#4E4A4E', '#854C30', '#346524', '#D04648', '#757161',
      '#597DCE', '#D27D2C', '#8595A1', '#6DAA2C', '#D2AA99', '#6DC2CA', '#DAD45E', '#DEEED6',
    ],
  },
  {
    id: 'db32',
    name: 'DawnBringer 32',
    builtin: true,
    colors: [
      '#000000', '#222034', '#45283C', '#663931', '#8F563B', '#DF7126', '#D9A066', '#EEC39A',
      '#FBF236', '#99E550', '#6ABE30', '#37946E', '#4B692F', '#524B24', '#323C39', '#3F3F74',
      '#306082', '#5B6EE1', '#639BFF', '#5FCDE4', '#CBDBFC', '#FFFFFF', '#9BADB7', '#847E87',
      '#696A6A', '#595652', '#76428A', '#AC3232', '#D95763', '#D77BBA', '#8F974A', '#8A6F30',
    ],
  },
  {
    id: 'endesga32',
    name: 'Endesga 32',
    builtin: true,
    colors: [
      '#BE4A2F', '#D77643', '#EAD4AA', '#E4A672', '#B86F50', '#733E39', '#3E2731', '#A22633',
      '#E43B44', '#F77622', '#FEAE34', '#FEE761', '#63C74D', '#3E8948', '#265C42', '#193C3E',
      '#124E89', '#0099DB', '#2CE8F5', '#FFFFFF', '#C0CBDC', '#8B9BB4', '#5A6988', '#3A4466',
      '#262B44', '#181425', '#FF0044', '#68386C', '#B55088', '#F6757A', '#E8B796', '#C28569',
    ],
  },
  {
    id: 'endesga64',
    name: 'Endesga 64',
    builtin: true,
    colors: [
      '#FF0040', '#131313', '#1B1B1B', '#272727', '#3D3D3D', '#5D5D5D', '#858585', '#B4B4B4',
      '#FFFFFF', '#C7CFDD', '#92A1B9', '#657392', '#424C6E', '#2A2F4E', '#1A1932', '#0E071B',
      '#1C121C', '#391F21', '#5D2C28', '#8A4836', '#BF6F4A', '#E69C69', '#F6CA9F', '#F9E6CF',
      '#EDAB50', '#E07438', '#C64524', '#8E251D', '#FF5000', '#ED7614', '#FFA214', '#FFC825',
      '#FFEB57', '#D3FC7E', '#99E65F', '#5AC54F', '#33984B', '#1E6F50', '#134C4C', '#0C2E44',
      '#00396D', '#0069AA', '#0098DC', '#00CDF9', '#0CF1FF', '#94FDFF', '#FDD2ED', '#F389F5',
      '#DB3FFD', '#7A09FA', '#3003D9', '#0C0293', '#03193F', '#3B1443', '#622461', '#93388F',
      '#CA52C9', '#C85086', '#F68187', '#F5555D', '#EA323C', '#C42430', '#891E2B', '#571C27',
    ],
  },
  {
    id: 'resurrect64',
    name: 'Resurrect 64',
    builtin: true,
    colors: [
      '#2E222F', '#3E3546', '#625565', '#966C6C', '#AB947A', '#694F62', '#7F708A', '#9BABB2',
      '#C7DCD0', '#FFFFFF', '#6E2727', '#B33831', '#EA4F36', '#F57D4A', '#AE2334', '#E83B3B',
      '#FB6B1D', '#F79617', '#F9C22B', '#7A3045', '#9E4539', '#CD683D', '#E6904E', '#FBB954',
      '#4C3E24', '#676633', '#A2A947', '#D5E04B', '#FBFF86', '#165A4C', '#239063', '#1EBC73',
      '#91DB69', '#CDDF6C', '#313638', '#374E4A', '#547E64', '#92A984', '#B2BA90', '#0B5E65',
      '#0B8A8F', '#0EAF9B', '#30E1B9', '#8FF8E2', '#323353', '#484A77', '#4D65B4', '#4D9BE6',
      '#8FD3FF', '#45293F', '#6B3E75', '#905EA9', '#A884F3', '#EAADED', '#753C54', '#A24B6F',
      '#CF657F', '#ED8099', '#831C5D', '#C32454', '#F04F78', '#F68181', '#FCA790', '#FDCBB0',
    ],
  },
  {
    id: 'apollo46',
    name: 'Apollo (46)',
    builtin: true,
    colors: [
      '#172038', '#253A5E', '#3C5E8B', '#4F8FBA', '#73BED3', '#A4DDDB', '#19332D', '#25562E',
      '#468232', '#75A743', '#A8CA58', '#D0DA91', '#4D2B32', '#7A4841', '#AD7757', '#C09473',
      '#D7B594', '#E7D5B3', '#341C27', '#602C2C', '#884B2B', '#BE772B', '#DE9E41', '#E8C170',
      '#241527', '#411D31', '#752438', '#A53030', '#CF573C', '#DA863E', '#1E1D39', '#402751',
      '#7A367B', '#A23E8C', '#C65197', '#DF84A5', '#090A14', '#10141F', '#151D28', '#202E37',
      '#394A50', '#577277', '#819796', '#A8B5B2', '#C7CFCC', '#EBEDE9',
    ],
  },
  {
    id: 'aap64',
    name: 'AAP-64 (64)',
    builtin: true,
    colors: [
      '#060608', '#141013', '#3B1725', '#73172D', '#B4202A', '#DF3E23', '#FA6A0A', '#F9A31B',
      '#FFD541', '#FFFC40', '#D6F264', '#9CDB43', '#59C135', '#14A02E', '#1A7A3E', '#24523B',
      '#122020', '#143464', '#285CC4', '#249FDE', '#20D6C7', '#A6FCDB', '#FFFFFF', '#FEF3C0',
      '#FAD6B8', '#F5A097', '#E86A73', '#BC4A9B', '#793A80', '#403353', '#242234', '#221C1A',
      '#322B28', '#71413B', '#BB7547', '#DBA463', '#F4D29C', '#DAE0EA', '#B3B9D1', '#8B93AF',
      '#6D758D', '#4A5462', '#333941', '#422433', '#5B3138', '#8E5252', '#BA756A', '#E9B5A3',
      '#E3E6FF', '#B9BFFB', '#849BE4', '#588DBE', '#477D85', '#23674E', '#328464', '#5DAF8D',
      '#92DCBA', '#CDF7E2', '#E4D2AA', '#C7B08B', '#A08662', '#796755', '#5A4E44', '#423934',
    ],
  },
  {
    id: 'vinik24',
    name: 'Vinik 24',
    builtin: true,
    colors: [
      '#000000', '#6F6776', '#9A9A97', '#C5CCB8', '#8B5580', '#C38890', '#A593A5', '#666092',
      '#9A4F50', '#C28D75', '#7CA1C0', '#416AA3', '#8D6268', '#BE955C', '#68ACA9', '#387080',
      '#6E6962', '#93A167', '#6EAA78', '#557064', '#9D9F7F', '#7E9E99', '#5D6872', '#433455',
    ],
  },
  {
    id: 'slso8',
    name: 'SLSO8 大气冷暖',
    builtin: true,
    colors: ['#0D2B45', '#203C56', '#544E68', '#8D697A', '#D08159', '#FFAA5E', '#FFD4A3', '#FFECD6'],
  },
  {
    id: 'oil6',
    name: 'Oil 6 复古油画',
    builtin: true,
    colors: ['#FBF5EF', '#F2D3AB', '#C69FA5', '#8B6D9C', '#494D7E', '#272744'],
  },
  {
    id: 'gb',
    name: 'GameBoy 经典绿',
    builtin: true,
    colors: ['#0F380F', '#306230', '#8BAC0F', '#9BBC0F'],
  },
  {
    id: 'icecreamgb',
    name: 'Ice Cream GB 奶昔',
    builtin: true,
    colors: ['#7C3F58', '#EB6B6F', '#F9A875', '#FFF6D3'],
  },
  {
    id: 'cga16',
    name: 'CGA 复古 16 色',
    builtin: true,
    colors: [
      '#000000', '#0000AA', '#00AA00', '#00AAAA', '#AA0000', '#AA00AA', '#AA5500', '#AAAAAA',
      '#555555', '#5555FF', '#55FF55', '#55FFFF', '#FF5555', '#FF55FF', '#FFFF55', '#FFFFFF',
    ],
  },
  {
    id: 'nes54',
    name: 'NES 红白机 (54)',
    builtin: true,
    colors: [
      '#7C7C7C', '#0000FC', '#0000BC', '#4428BC', '#940084', '#A80020', '#A81000', '#881400',
      '#503000', '#007800', '#006800', '#005800', '#004058', '#000000', '#BCBCBC', '#0078F8',
      '#0058F8', '#6844FC', '#D800CC', '#E40058', '#F83800', '#E45C10', '#AC7C00', '#00B800',
      '#00A800', '#00A844', '#008888', '#F8F8F8', '#3CBCFC', '#6888FC', '#9878F8', '#F878F8',
      '#F85898', '#F87858', '#FCA044', '#F8B800', '#B8F818', '#58D854', '#58F898', '#00E8D8',
      '#787878', '#FCFCFC', '#A4E4FC', '#B8B8F8', '#D8B8F8', '#F8B8F8', '#F8A4C0', '#F0D0B0',
      '#FCE0A8', '#F8D878', '#D8F878', '#B8F8B8', '#B8F8D8', '#00FCFC',
    ],
  },
  {
    id: 'iso_arch32',
    name: '轴测建筑 · 城市建材 (32)',
    builtin: true,
    colors: [
      '#1C1F26', '#2D323D', '#434A59', '#616A7D', '#8590A6', '#AEB8CC', '#D7DFEC', '#F4F7FC',
      '#1C3144', '#2A4B6A', '#3D6E99', '#5A96C7', '#89C2EB', '#BDE6FA', '#5C241E', '#8A382E',
      '#B54E3E', '#D46E57', '#E89B84', '#5C4430', '#876548', '#B38B67', '#D6B692', '#EFE0C4',
      '#1F3D2B', '#2F5E3F', '#478556', '#6DAD73', '#9ED18E', '#F59E0B', '#FCD34D', '#FEF3C7',
    ],
  },
  {
    id: 'cyberpunk24',
    name: '赛博朋克霓虹 (24)',
    builtin: true,
    colors: [
      '#09050F', '#140C24', '#23163D', '#38245E', '#57368A', '#8C45BD', '#FF007F', '#FF4DB8',
      '#FFA3E0', '#7B2CBF', '#3A0CA3', '#4361EE', '#4CC9F0', '#00F5D4', '#72EFDD', '#E0FBFC',
      '#FFE600', '#FF9E00', '#FF5400', '#FF003C', '#111827', '#334155', '#64748B', '#F8FAFC',
    ],
  },
  {
    id: 'nature24',
    name: '森系自然风光 (24)',
    builtin: true,
    colors: [
      '#0F1B14', '#1B3022', '#294932', '#3B6944', '#538D54', '#78B366', '#A9D47C', '#D8ED9E',
      '#2B1E16', '#4A3423', '#6E4F35', '#96704D', '#BD9871', '#DFC6A2', '#173A54', '#255B7E',
      '#3A84A8', '#61B2CC', '#98DCE8', '#E2F6FA', '#E57A44', '#F4B860', '#FFF1C9', '#FFFFFF',
    ],
  },
  {
    id: 'pastel20',
    name: '柔和马卡龙 Pastel (20)',
    builtin: true,
    colors: [
      '#3D344A', '#6A5D7B', '#9D8CA8', '#D8CEE6', '#FFFDF9', '#FFADAD', '#FFD6A5', '#FDFFB6',
      '#CAFFBF', '#9BF6FF', '#A0C4FF', '#BDB2FF', '#FFC6FF', '#F4978E', '#F8AD9D', '#FBC4AB',
      '#B5E2FA', '#EDDEA4', '#CDEAC0', '#E2ECE9',
    ],
  },
  {
    id: 'skintones24',
    name: '人物肤色与肖像阶梯 (24)',
    builtin: true,
    colors: [
      '#2B1712', '#42241B', '#5E3426', '#7B4634', '#9B5C45', '#BA765B', '#D69577', '#EBB598',
      '#F7D0B6', '#FDE5D2', '#FFF5EB', '#3D1E22', '#643237', '#8F4D4E', '#BC6F6B', '#DF958B',
      '#F2BEB2', '#F8DDD4', '#57362D', '#7E5345', '#A97964', '#CFA38C', '#E8C9B5', '#F7E7DA',
    ],
  },
  {
    id: 'gray',
    name: '灰阶 (9)',
    builtin: true,
    colors: ['#000000', '#222222', '#444444', '#666666', '#888888', '#AAAAAA', '#CCCCCC', '#EEEEEE', '#FFFFFF'],
  },
  {
    id: 'mono16',
    name: '精细灰阶 (16)',
    builtin: true,
    colors: [
      '#000000', '#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777',
      '#888888', '#999999', '#AAAAAA', '#BBBBBB', '#CCCCCC', '#DDDDDD', '#EEEEEE', '#FFFFFF',
    ],
  },
];

const KEY = 'blendermeow.palettes';

export function loadUserPalettes(): Palette[] {
  if (typeof localStorage !== 'undefined') {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (Array.isArray(v) && v.length > 0) return v;
    } catch { /* ignore */ }
  }
  return [{ id: 'mine', name: '我的色板', colors: [] }];
}

export function saveUserPalettes(p: Palette[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch { /* ignore */ }
}

/** parse .gpl (GIMP), .hex (lospec), or plain text list of hex colors */
export function parsePaletteFile(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (hex: string) => {
    const u = hex.toUpperCase();
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || (line.startsWith('#') && !/^#[0-9a-f]{6}$/i.test(line)) || /^(GIMP|Name|Columns)/i.test(line)) continue;
    const gpl = line.match(/^(\d+)\s+(\d+)\s+(\d+)/);
    if (gpl) {
      push(
        toHex({
          r: clamp(Math.round(+gpl[1]), 0, 255),
          g: clamp(Math.round(+gpl[2]), 0, 255),
          b: clamp(Math.round(+gpl[3]), 0, 255),
        }),
      );
      continue;
    }
    const hex = line.match(/#?([0-9a-f]{6})/i);
    if (hex) push('#' + hex[1]);
  }
  return out;
}

/** Extract unique #RRGGBB colors from serialized .bmeow project JSON */
export function extractColorsFromBmeowJson(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const obj = parsed as { layers?: Array<{ shape?: Record<string, unknown> }> };
  if (!Array.isArray(obj.layers)) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  const addRgba = (c: unknown) => {
    if (!c || typeof c !== 'object') return;
    const rgba = c as { r?: unknown; g?: unknown; b?: unknown };
    if (typeof rgba.r !== 'number' || typeof rgba.g !== 'number' || typeof rgba.b !== 'number') return;
    if (!Number.isFinite(rgba.r) || !Number.isFinite(rgba.g) || !Number.isFinite(rgba.b)) return;
    const hex = toHex({ r: rgba.r, g: rgba.g, b: rgba.b });
    if (!seen.has(hex)) {
      seen.add(hex);
      out.push(hex);
    }
  };

  for (const l of obj.layers) {
    const s = l?.shape;
    if (!s || typeof s !== 'object') continue;
    addRgba(s.baseColor);
    addRgba(s.roofColor);
    addRgba(s.outlineColor);
    const pat = s.pattern as { primaryColor?: unknown } | undefined;
    if (pat && typeof pat === 'object') {
      addRgba(pat.primaryColor);
    }
  }
  return out;
}

export function paletteToGpl(p: Palette): string {
  const lines = ['GIMP Palette', `Name: ${p.name}`, 'Columns: 8', '#'];
  for (const c of p.colors) {
    const r = parseInt(c.slice(1, 3), 16) || 0;
    const g = parseInt(c.slice(3, 5), 16) || 0;
    const b = parseInt(c.slice(5, 7), 16) || 0;
    lines.push(`${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${c}`);
  }
  return lines.join('\n');
}
