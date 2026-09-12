export type MobileTabIcon = 'home' | 'health' | 'assistant' | 'space' | 'tasks' | 'report' | 'messages' | 'profile';

export interface MobileTabItem<T extends string> {
  id: T;
  label: string;
  icon: MobileTabIcon;
}

interface MobileTabBarProps<T extends string> {
  items: readonly MobileTabItem<T>[];
  active: T;
  onSelect: (id: T) => void;
}

function TabIcon({ name }: { name: MobileTabIcon }) {
  const paths: Record<MobileTabIcon, React.ReactNode> = {
    home: <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1Z" />,
    health: <path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10Z" />,
    assistant: (
      <>
        <path d="M5 6.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
        <path d="M8 12h.01M12 12h.01M16 12h.01" />
      </>
    ),
    space: (
      <>
        <path d="M3.5 11.5 12 4l8.5 7.5V21h-17Z" />
        <path d="M8 21v-6h8v6M17 7.7V4h2v5.5" />
      </>
    ),
    tasks: (
      <>
        <path d="M7 4h13v17H7Z" />
        <path d="m3 8 1.5 1.5L7 7M3 14l1.5 1.5L7 13M10 9h7M10 15h7" />
      </>
    ),
    report: (
      <>
        <path d="M6 3h9l3 3v15H6Z" />
        <path d="M9 11h6M9 15h6M9 7h3" />
      </>
    ),
    messages: (
      <>
        <path d="M5 5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 3v-4a2 2 0 0 1-1-1V7a2 2 0 0 1 2-2Z" />
        <path d="M8 10h8M8 14h5" />
      </>
    ),
    profile: (
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 21a7 7 0 0 1 14 0" />
      </>
    ),
  };

  return (
    <svg className="mobile-tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export default function MobileTabBar<T extends string>({ items, active, onSelect }: MobileTabBarProps<T>) {
  return (
    <nav className="mobile-tab-bar" aria-label="主要导航">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`mobile-tab ${active === item.id ? 'is-active' : ''}`}
          aria-current={active === item.id ? 'page' : undefined}
          onClick={() => onSelect(item.id)}
        >
          <TabIcon name={item.icon} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
