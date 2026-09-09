import type { HazardData, HazardItem, ItemInfo, PathItem, SceneMode } from '../types';

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

export function initPanel(data: HazardData, cb: PanelCallbacks, mode: SceneMode): void {
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
    const body = el<HTMLDivElement>('div', 'tab-body' + (i === 0 ? ' active' : ''));
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

  const counts = { high: 0, medium: 0, low: 0 };
  data.hazards.forEach(h => counts[h.level]++);
  const stats = el<HTMLDivElement>('stats', undefined, `
    <span class="badge lv-high">高 ${counts.high}</span>
    <span class="badge lv-mid">中 ${counts.medium}</span>
    <span class="badge lv-low">低 ${counts.low}</span>
    <div class="muted small">${mode === 'demo' ? '演示数据来自预置 Home Twin' : '仅显示已完成真实空间标定的数据，不伪造未标定结果'}</div>
  `);
  const list = el<HTMLDivElement>('hazard-list');
  data.hazards.forEach(h => {
    const calibrated = mode === 'demo' || Boolean(h.realPos);
    const row = el<HTMLButtonElement>('button', 'hazard-row' + (calibrated ? '' : ' disabled'), `
      <span class="dot ${LEVEL_CLASS[h.level]}"></span>
      <div class="hazard-text"><b>${h.title}</b><span class="muted small">${calibrated ? h.location : '尚未完成真实空间标定'}</span></div>
    `);
    row.disabled = !calibrated;
    row.onclick = () => cb.onSelectHazard(h);
    list.append(row);
  });
  bodiesMap.hazards.append(stats, list);

  const pathIntro = el<HTMLDivElement>('div', 'muted small',
    '真实模式只开放已经完成坐标标定的路线；未标定路线不会被伪造成可导航路径。');
  bodiesMap.paths.append(pathIntro);
  data.paths.forEach(p => {
    const calibrated = mode === 'demo' || Boolean(p.realPoints && p.realPoints.length >= 2);
    const btn = el<HTMLButtonElement>('button', 'path-row' + (calibrated ? '' : ' disabled'), `
      <span class="path-ico ${p.mode === 'night' ? 'night' : ''}">${p.mode === 'night' ? '🌙' : '☀'}</span>
      <div class="hazard-text"><b>${p.title}</b>
      <span class="muted small">${calibrated ? `途经 ${p.hazardIds.length} 处风险点` : '尚未完成真实空间标定'}</span></div>
    `);
    btn.disabled = !calibrated;
    let active = false;
    btn.onclick = () => {
      if (btn.disabled) return;
      active = !active;
      btn.classList.toggle('active', active);
      document.querySelectorAll('.path-row').forEach(b => {
        if (b !== btn) (b as HTMLElement).classList.remove('active');
      });
      cb.onSelectPath(active ? p : null);
    };
    bodiesMap.paths.append(btn);
  });

  const findIntro = el<HTMLDivElement>('div', 'muted small',
    mode === 'demo' ? '演示模式使用预置物品位置；真实模式只显示已完成空间标定的物品。' : '真实模式只使用已经完成空间标定的物品位置。');
  bodiesMap.find.append(findIntro);
  data.items.forEach(item => {
    const calibrated = mode === 'demo' || Boolean(item.realPos);
    const btn = el<HTMLButtonElement>('button', 'item-row' + (calibrated ? '' : ' disabled'), `
      <span class="path-ico">🔍</span>
      <div class="hazard-text"><b>${item.title}</b><span class="muted small">${calibrated ? item.location : '尚未完成真实空间标定'}</span></div>
    `);
    btn.disabled = !calibrated;
    btn.onclick = () => cb.onSelectItem(item);
    bodiesMap.find.append(btn);
  });
}

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

export function setHint(text: string): void {
  const hint = document.getElementById('hint')!;
  hint.textContent = text;
  hint.classList.add('visible');
}