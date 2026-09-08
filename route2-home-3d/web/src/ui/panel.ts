import type { HazardData, HazardItem, ItemInfo, PathItem } from '../types';

export interface PanelCallbacks {
  onSelectHazard(h: HazardItem): void;
  onSelectPath(p: PathItem | null): void;
  onSelectItem(item: ItemInfo): void;
}

const LEVEL_CLASS: Record<string, string> = { high: 'lv-high', medium: 'lv-mid', low: 'lv-low' };

function el<T extends HTMLElement>(tag: string, cls?: string, html?: string): T {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e as T;
}

export function initPanel(data: HazardData, cb: PanelCallbacks): void {
  const panel = document.getElementById('panel')!;
  panel.innerHTML = '';

  const tabs = el<HTMLDivElement>('div', 'tabs');
  const bodies = el<HTMLDivElement>('div', 'tab-bodies');
  panel.append(tabs, bodies);

  const tabDefs = [
    { key: 'hazards', label: '安全巡检' },
    { key: 'paths', label: '动线分析' },
    { key: 'find', label: '找东西' }
  ] as const;

  const tabButtons: HTMLElement[] = [];
  const bodiesMap: Record<string, HTMLElement> = {};

  tabDefs.forEach((def, i) => {
    const btn = el<HTMLButtonElement>('button', 'tab-btn' + (i === 0 ? ' active' : ''), def.label);
    const body = el<HTMLDivElement>('tab-body' + (i === 0 ? ' active' : ''));
    btn.onclick = () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      Object.values(bodiesMap).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      body.classList.add('active');
      if (def.key !== 'paths') cb.onSelectPath(null);
    };
    tabButtons.push(btn);
    bodiesMap[def.key] = body;
    tabs.append(btn);
  });
  bodies.append(...Object.values(bodiesMap));

  // ---------- 安全巡检 ----------
  const counts = { high: 0, medium: 0, low: 0 };
  data.hazards.forEach(h => counts[h.level]++);
  const stats = el<HTMLDivElement>('stats', undefined, `
    <span class="badge lv-high">高 ${counts.high}</span>
    <span class="badge lv-mid">中 ${counts.medium}</span>
    <span class="badge lv-low">低 ${counts.low}</span>
    <div class="muted small">AI 已扫描居住空间, 点击查看详情</div>
  `);
  const list = el<HTMLDivElement>('hazard-list');
  data.hazards.forEach(h => {
    const row = el<HTMLButtonElement>('hazard-row', undefined, `
      <span class="dot ${LEVEL_CLASS[h.level]}"></span>
      <div class="hazard-text"><b>${h.title}</b><span class="muted small">${h.location}</span></div>
    `);
    row.onclick = () => cb.onSelectHazard(h);
    list.append(row);
  });
  bodiesMap.hazards.append(stats, list);

  // ---------- 动线分析 ----------
  const pathIntro = el<HTMLDivElement>('muted small', undefined,
    '分析老人日常活动路线上的叠加风险, 夜间动线自动切换为夜间环境。');
  bodiesMap.paths.append(pathIntro);
  data.paths.forEach(p => {
    const btn = el<HTMLButtonElement>('path-row', undefined, `
      <span class="path-ico ${p.mode === 'night' ? 'night' : ''}">${p.mode === 'night' ? '🌙' : '☀'}</span>
      <div class="hazard-text"><b>${p.title}</b>
      <span class="muted small">途经 ${p.hazardIds.length} 处风险点</span></div>
    `);
    let active = false;
    btn.onclick = () => {
      active = !active;
      btn.classList.toggle('active', active);
      document.querySelectorAll('.path-row').forEach(b => {
        if (b !== btn) { (b as HTMLElement).classList.remove('active'); }
      });
      cb.onSelectPath(active ? p : null);
    };
    bodiesMap.paths.append(btn);
  });

  // ---------- 找东西 ----------
  const findIntro = el<HTMLDivElement>('muted small', undefined,
    '对着模型说出物品, 系统在 3D 空间中定位并指引路线。');
  bodiesMap.find.append(findIntro);
  data.items.forEach(item => {
    const btn = el<HTMLButtonElement>('item-row', undefined, `
      <span class="path-ico">🔍</span>
      <div class="hazard-text"><b>${item.title}</b><span class="muted small">${item.location}</span></div>
    `);
    btn.onclick = () => cb.onSelectItem(item);
    bodiesMap.find.append(btn);
  });
}

/** 危险点信息卡 */
export function showHazardCard(h: HazardItem, levelNames: Record<string, string>): void {
  const card = document.getElementById('hazard-card')!;
  card.dataset.level = h.level;
  card.innerHTML = `
    <button class="card-close" title="关闭">✕</button>
    <div class="card-head">
      <span class="badge ${LEVEL_CLASS[h.level]}">${levelNames[h.level] ?? h.level}</span>
      <b>${h.title}</b>
    </div>
    <div class="card-line"><span class="muted">位置</span>${h.location}</div>
    <div class="card-line"><span class="muted">风险</span>${h.risk}</div>
    <div class="card-line"><span class="muted">建议</span>${h.advice}</div>
  `;
  card.classList.remove('hidden');
  card.querySelector('.card-close')!.addEventListener('click', () => card.classList.add('hidden'));
}

export function hideHazardCard(): void {
  document.getElementById('hazard-card')!.classList.add('hidden');
}

/** 底部提示条 */
export function setHint(text: string): void {
  const hint = document.getElementById('hint')!;
  hint.textContent = text;
  hint.classList.add('visible');
}