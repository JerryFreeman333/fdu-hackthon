import { useEffect, useState } from 'react';

export type FontScale = 'normal' | 'large' | 'extraLarge';

const FONT_SCALE_KEY = 'ankang-route1-font-scale-v1';

function loadFontScale(): FontScale {
  const saved = window.localStorage.getItem(FONT_SCALE_KEY);
  return saved === 'large' || saved === 'extraLarge' ? saved : 'normal';
}

export function useFontScale() {
  const [fontScale, setFontScale] = useState<FontScale>(() => loadFontScale());

  useEffect(() => {
    document.body.dataset.fontScale = fontScale;
    window.localStorage.setItem(FONT_SCALE_KEY, fontScale);
  }, [fontScale]);

  return { fontScale, setFontScale };
}

export { FONT_SCALE_KEY };
