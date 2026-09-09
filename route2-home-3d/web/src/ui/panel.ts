import type { HazardData, HazardItem, ItemInfo, PathItem, SceneMode } from '../types';
import type { HomeSafetyActionPlan } from '../hometwin/actionPlan';
import type { Route2Role } from './roleMode';

export interface PanelCallbacks {
  onSelectHazard(h: HazardItem): void;
  onSelectPath(p: PathItem | null): void;
  onSelectItem(item: ItemInfo): void;
  onRescan?(): void;
}

const LEVEL_CLASS: Record<string, string> = { high: 'lv-high', medium: 'lv-mid', low: 'lv-low' };

function el<T extends HTMLElement>(tag: string, cls?: string, html?: string): T {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e as T;
}

function actionStatusLabel(status: HomeSafetyActionPlan['actions'][number]['status']): string {
  if (status === 'resolved') return '已通过复扫';
  if (status === 'completed') return '已处理，待复扫';
  if (status === 'in_progress') return '处理中';
  return '待处理';
}

function renderActionPlan(body: HTMLElement, plan: HomeSafetyActionPlan | null, onRescan?: () => void): void {
  body.innerHTML = '';
  if (!plan) {
    body.append(el<HTMLDivElement>('div', 'muted small', '暂未接入家庭行动计划。'));
    return;
  }

  body.append(el<HTMLDivElement>('div', 'muted small', '家庭行动不是“风险分数”。处理完成后必须重新扫描，只有对应风险消失才会关闭任务。'));

  const summary = el<HTMLDivElement>('div', 'action-summary', `
    <span class="badge ${plan.status === 'clear' ? 'badge-resolved' : 'badge-action'}">${plan.status === 'clear' ? '环境风险已关闭' : '有待处理事项'}</span>
    <span class="muted small">${plan.actions.filter(a => a.status === 'open' || a.status === 'in_progress').length} 个待处理</span>
  `);
  body.append(summary);

  if (!plan.actions.length) {
    body.append(el<HTMLDivElement>('div', 'action-empty', '当前没有家庭行动任务。'));
  } else {
    const list = el<HTMLDivElement>('div', 'action-list');
    for (const action of plan.actions) {
      const row = el<HTMLDivElement>('div', `action-row action-${action.status}`, `
        <div class="action-head"><b>${action.title}</b><span class="badge">${actionStatusLabel(action.status)}</span></div>
        <div class="muted small">${action.description}</div>
        <div class="action-meta">riskId: ${action.riskId}</div>
      `);
      list.append(row);
    }
    body.append(list);
  }

  if (plan.status !== 'clear' && onRescan) {
    const button = el<HTMLButtonElement>('button', 'action-rescan-btn', '🔄 已处理？重新扫描确认');
    button.onclick = () => onRescan();
    body.append(button);
  } else if (plan.status === 'clear') {
    body.append(el<HTMLDivElement>('div', 'action-resolved-note', '✓ 本轮复扫未再发现对应风险，任务已自动关闭。'));
  }
}

function renderRoleHome(data: HazardData, body: HTMLElement, cb: PanelCallbacks, mode: SceneMode, role: Route2Role, actionPlan: HomeSafetyActionPlan | null): { updateActionPlan(plan: HomeSafetyActionPlan | null): void } {
  body.innerHTML = '';

  const title = role === 'resident' ? '我的家' : '家庭状态';
  const intro = role === 'resident'
    ? '这里帮您找回常用物品。安全问题会尽量用简单的话提醒您，复杂处理会交给家人。'
    : '这里展示家庭环境中值得关注、需要家属确认或处理的事项。';
  body.append(el<HTMLDivElement>('div', 'panel-section-title', title));
  body.append(el<HTMLDivElement>('div', 'muted small panel-intro', intro));

  if (role === 'resident') {
    const findShortcut = el<HTMLButtonElement>('button', 'feature-card primary-card', '🔍 找东西<span>找老花镜、钥匙等常用物品</span>');
    findShortcut.onclick = () => {
      document.querySelector<HTMLButtonElement>('[data-role-tab="find"]')?.click();
    };
    body.append(findShortcut);

    const medicineShortcut = el<HTMLDivElement>('div', 'feature-card', '💊 找药<span>当前原型仅提供已登记药品位置；服用信息不替代医生、药师或说明书。</span>');
    body.append(medicineShortcut);

    const tip = el<HTMLDivElement>('div', 'role-note', '需要家人处理的环境问题不会要求您自己判断。系统会把需要介入的事项交给子女/照护者。');
    body.append(tip);
  } else {
    body.append(el<HTMLDivElement>('div', 'family-summary', `当前 ${data.hazards.length} 个演示风险项；只有已具备空间证据的数据才允许进入真实模式。`));
    renderActionPlan(body, actionPlan, cb.onRescan);
  }

  return {
    updateActionPlan(plan) {
      if (role === 'family') renderActionPlan(body, plan, cb.onRescan);
    },
  };
}

export function initPanel(data: HazardData, cb: PanelCallbacks, mode: SceneMode, actionPlan: HomeSafetyActionPlan | null = null, role: Route2Role = 'resident'): { updateActionPlan(plan: HomeSafetyActionPlan | null): void; setRole(nextRole: Route2Role): void } {
  const panel = document.getElementById('panel')!;
  panel.innerHTML = '';

  const tabBar = el<HTMLDivElement>('div', 'tabs');
  const bodies = el<HTMLDivElement>('div', 'tab-bodies');
  panel.append(tabBar, bodies);

  const roleSections = new Map<Route2Role, { home: HTMLElement; find: HTMLElement; hazards: HTMLElement; paths: HTMLElement; update(plan: HomeSafetyActionPlan | null): void }>();

  function buildSection(key: string, label: string, visible: boolean): { button: HTMLButtonElement; body: HTMLDivElement } {
    const button = el<HTMLButtonElement>('button', 'tab-btn' + (visible ? ' active' : ''), label);
    const body = el<HTMLDivElement>('div', 'tab-body' + (visible ? ' active' : ''));
    button.dataset.roleTab = key;
    tabBar.append(button);
    bodies.append(body);
    return { button, body };
  }

  const residentHome = buildSection('home', '我的家', role === 'resident');
  const residentFind = buildSection('find', '找东西', role === 'resident');
  const familyHome = buildSection('family-home', '家庭状态', role === 'family');
  const familyHazards = buildSection('family-hazards', '风险证据', false);
  const familyPaths = buildSection('family-paths', '影响路线', false);
  const sections = [residentHome, residentFind, familyHome, familyHazards, familyPaths];

  function activate(button: HTMLButtonElement, body: HTMLElement): void {
    sections.forEach(section => {
      section.button.classList.remove('active');
      section.body.classList.remove('active');
    });
    button.classList.add('active');
    body.classList.add('active');
    if (body !== familyPaths.body) cb.onSelectPath(null);
  }

  sections.forEach(section => section.button.onclick = () => activate(section.button, section.body));

  const counts = { high: 0, medium: 0, low: 0 };
  data.hazards.forEach(h => counts[h.level]++);

  const homeController = renderRoleHome(data, residentHome.body, cb, mode, 'resident', actionPlan);
  const familyController = renderRoleHome(data, familyHome.body, cb, mode, 'family', actionPlan);

  const stats = el<HTMLDivElement>('div', 'stats', `
    <span class="badge lv-high">高 ${counts.high}</span>
    <span class="badge lv-mid">中 ${counts.medium}</span>
    <span class="badge lv-low">低 ${counts.low}</span>
    <div class="muted small">${mode === 'demo' ? '演示数据来自预置 Home Twin' : '仅显示已完成真实空间标定的数据，不伪造未标定结果'}</div>
  `);
  const hazardList = el<HTMLDivElement>('div', 'hazard-list');
  data.hazards.forEach(h => {
    const calibrated = mode === 'demo' || Boolean(h.realPos);
    const row = el<HTMLButtonElement>('button', 'hazard-row' + (calibrated ? '' : ' disabled'), `
      <span class="dot ${LEVEL_CLASS[h.level]}"></span>
      <div class="hazard-text"><b>${h.title}</b><span class="muted small">${calibrated ? h.location : '尚未完成真实空间标定'}</span></div>
    `);
    row.disabled = !calibrated;
    row.onclick = () => cb.onSelectHazard(h);
    hazardList.append(row);
  });
  familyHazards.body.append(stats, hazardList);

  const pathIntro = el<HTMLDivElement>('div', 'muted small', '路线用于解释风险影响范围，不代表 AI 已预测老人实际会怎么走。');
  familyPaths.body.append(pathIntro);
  data.paths.forEach(p => {
    const calibrated = mode === 'demo' || Boolean(p.realPoints && p.realPoints.length >= 2);
    const btn = el<HTMLButtonElement>('button', 'path-row' + (calibrated ? '' : ' disabled'), `
      <span class="path-ico ${p.mode === 'night' ? 'night' : ''}">${p.mode === 'night' ? '🌙' : '☀'}</span>
      <div class="hazard-text"><b>${p.title}</b><span class="muted small">${calibrated ? `影响 ${p.hazardIds.length} 个已标注风险` : '尚未完成真实空间标定'}</span></div>
    `);
    btn.disabled = !calibrated;
    let active = false;
    btn.onclick = () => {
      if (btn.disabled) return;
      active = !active;
      btn.classList.toggle('active', active);
      document.querySelectorAll('.path-row').forEach(b => { if (b !== btn) (b as HTMLElement).classList.remove('active'); });
      cb.onSelectPath(active ? p : null);
    };
    familyPaths.body.append(btn);
  });

  const findIntro = el<HTMLDivElement>('div', 'muted small', mode === 'demo' ? '演示模式使用预置物品位置；真实模式只显示已完成空间标定的物品。' : '只使用已经完成空间标定的物品位置。');
  residentFind.body.append(findIntro);
  data.items.forEach(item => {
    const calibrated = mode === 'demo' || Boolean(item.realPos);
    const btn = el<HTMLButtonElement>('button', 'item-row' + (calibrated ? '' : ' disabled'), `
      <span class="path-ico">🔍</span>
      <div class="hazard-text"><b>${item.title}</b><span class="muted small">${calibrated ? item.location : '尚未完成真实空间标定'}</span></div>
    `);
    btn.disabled = !calibrated;
    btn.onclick = () => cb.onSelectItem(item);
    residentFind.body.append(btn);
  });

  function setRole(nextRole: Route2Role): void {
    role = nextRole;
    sections.forEach(section => {
      const belongsToRole = nextRole === 'resident'
        ? (section.button.dataset.roleTab === 'home' || section.button.dataset.roleTab === 'find')
        : section.button.dataset.roleTab === 'family-home' || section.button.dataset.roleTab === 'family-hazards' || section.button.dataset.roleTab === 'family-paths';
      section.button.style.display = belongsToRole ? '' : 'none';
      section.body.classList.remove('active');
      section.button.classList.remove('active');
    });
    const first = nextRole === 'resident' ? residentHome : familyHome;
    first.button.style.display = '';
    activate(first.button, first.body);
  }

  setRole(role);

  return {
    updateActionPlan(plan) {
      familyController.updateActionPlan(plan);
    },
    setRole,
  };
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
