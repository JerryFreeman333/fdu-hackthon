import { useEffect, useState } from 'react';
import type { UserRole } from '../types';

export type FontScale = 'normal' | 'large' | 'extraLarge';

const FONT_SCALE_KEY = 'ankang-route1-font-scale-v1';

function loadSavedFontScale(): FontScale | null {
  const saved = window.localStorage.getItem(FONT_SCALE_KEY);
  return saved === 'normal' || saved === 'large' || saved === 'extraLarge' ? saved : null;
}

// 老人端默认特大字；家属端默认标准。只有用户在字号控件里明确选择过才持久化，
// 否则默认值始终跟随当前身份，避免家属先用的设备把"标准"锁死给老人。
function defaultFontScale(role: UserRole | null): FontScale {
  return role === 'elder' ? 'extraLarge' : 'normal';
}

export function useFontScale(role: UserRole | null) {
  const [fontScale, setFontScale] = useState<FontScale>(() => loadSavedFontScale() ?? defaultFontScale(role));

  useEffect(() => {
    document.body.dataset.fontScale = fontScale;
  }, [fontScale]);

  useEffect(() => {
    if (loadSavedFontScale() === null) setFontScale(defaultFontScale(role));
  }, [role]);

  const updateFontScale = (value: FontScale) => {
    setFontScale(value);
    window.localStorage.setItem(FONT_SCALE_KEY, value);
  };

  return { fontScale, setFontScale: updateFontScale };
}

export { FONT_SCALE_KEY };
