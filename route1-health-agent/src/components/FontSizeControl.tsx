import type { FontScale } from '../hooks/useFontScale';

interface FontSizeControlProps {
  value: FontScale;
  onChange: (value: FontScale) => void;
}

export default function FontSizeControl({ value, onChange }: FontSizeControlProps) {
  return (
    <label className="font-size-control">
      <span>字号</span>
      <select aria-label="调整字号" value={value} onChange={(event) => onChange(event.target.value as FontScale)}>
        <option value="normal">标准</option>
        <option value="large">大字</option>
        <option value="extraLarge">特大字</option>
      </select>
    </label>
  );
}
