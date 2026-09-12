export type Route2Role = 'resident' | 'family';

const STORAGE_KEY = 'route2-role';

export function readStoredRole(): Route2Role {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'family' ? 'family' : 'resident';
  } catch {
    return 'resident';
  }
}

export function hasStoredRole(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function persistRole(role: Route2Role): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, role);
  } catch {
    // Preference persistence is optional; product behavior must still work.
  }
}

export function createRoleSwitcher(initialRole: Route2Role, onChange: (role: Route2Role) => void): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'role-switcher';
  wrapper.setAttribute('role', 'group');
  wrapper.setAttribute('aria-label', '使用身份');

  const roles: Array<{ key: Route2Role; label: string }> = [
    { key: 'resident', label: '我是老人' },
    { key: 'family', label: '我是子女/照护者' },
  ];

  for (const role of roles) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'role-btn';
    button.textContent = role.label;
    button.dataset.role = role.key;
    button.setAttribute('aria-pressed', String(role.key === initialRole));
    button.onclick = () => {
      persistRole(role.key);
      onChange(role.key);
    };
    wrapper.append(button);
  }

  return wrapper;
}

export function updateRoleSwitcher(root: HTMLElement, role: Route2Role): void {
  root.querySelectorAll<HTMLButtonElement>('.role-btn').forEach((button) => {
    const active = button.dataset.role === role;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
