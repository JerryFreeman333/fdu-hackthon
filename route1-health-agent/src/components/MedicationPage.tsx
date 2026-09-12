import { useState } from 'react';
import type { ElderProfile, MedicationRecord } from '../types';

export function profileMedicines(profile: ElderProfile): MedicationRecord[] {
  const saved = profile.medicationRecords ?? [];
  return [
    ...saved,
    ...profile.medications
      .filter((name) => !saved.some((m) => m.name === name))
      .map((name, i) => ({
        id: `legacy-${i}-${name}`,
        name,
        dose: '',
        purpose: '',
        times: '',
        status: 'active' as const,
      })),
  ];
}
export default function MedicationPage({
  profile,
  onSave,
  onFind,
}: {
  profile: ElderProfile;
  onSave: (p: ElderProfile) => void;
  onFind: (name: string) => void;
}) {
  const [filter, setFilter] = useState('active');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<MedicationRecord | null>(null);
  const meds = profileMedicines(profile);
  const current = meds.find((m) => m.id === selected);
  function save() {
    if (!draft?.name.trim()) return;
    const next = [...meds.filter((m) => m.id !== draft.id), { ...draft, name: draft.name.trim() }];
    onSave({
      ...profile,
      medicationRecords: next,
      medications: next.filter((m) => m.status === 'active').map((m) => m.name),
    });
    setSelected(draft.id);
    setDraft(null);
  }
  if (draft)
    return (
      <section className="flow-page">
        <header className="flow-heading">
          <button onClick={() => setDraft(null)}>取消</button>
          <h1>{meds.some((m) => m.id === draft.id) ? '编辑药物' : '添加药物'}</h1>
        </header>
        <form
          className="card flow-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <p>请照药盒或医嘱填写，系统不会推测剂量。处方调整请咨询医生。</p>
          {(
            [
              ['name', '药物名称'],
              ['dose', '每次剂量（保留单位，如 1 片 / 5 mg）'],
              ['purpose', '用途 / 医嘱说明'],
              ['times', '服用时间（如 08:00、20:00）'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                required={key === 'name'}
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
            </label>
          ))}
          <label>
            使用状态
            <select
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as MedicationRecord['status'] })}
            >
              <option value="active">正在使用</option>
              <option value="stopped">曾经使用</option>
            </select>
          </label>
          <button className="btn-primary">保存药物</button>
        </form>
      </section>
    );
  if (current)
    return (
      <section className="flow-page">
        <header className="flow-heading">
          <button onClick={() => setSelected(null)}>返回药物</button>
          <button onClick={() => setDraft({ ...current })}>编辑</button>
        </header>
        <article className="card medicine-detail">
          <span className="medicine-symbol">＋</span>
          <h1>{current.name}</h1>
          <p>{current.status === 'active' ? '正在使用' : '曾经使用'}</p>
          <h2>服用方案（按医嘱）</h2>
          <dl>
            <dt>每次剂量</dt>
            <dd>{current.dose || '尚未填写，请核对医嘱后补充'}</dd>
            <dt>服用时间</dt>
            <dd>{current.times || '尚未填写'}</dd>
            <dt>药物用途 / 医嘱</dt>
            <dd>{current.purpose || '尚未填写'}</dd>
          </dl>
          <button className="btn-primary" onClick={() => onFind(current.name)}>
            找不到这盒药？去家庭空间查找
          </button>
          <p className="muted">
            查找交给路线二；没有位置档案时不会猜测药物位置。此处保存时间，不代表已启用手机后台推送。
          </p>
        </article>
      </section>
    );
  return (
    <section className="flow-page">
      <header className="page-title-block">
        <span className="page-kicker">按医嘱记录，安心用药</span>
        <h1>我的药物</h1>
      </header>
      <div className="flow-segments" aria-label="药物状态">
        {[
          ['active', '正在使用'],
          ['stopped', '曾经使用'],
          ['all', '全部'],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="medicine-list">
        {meds
          .filter((m) => filter === 'all' || m.status === filter)
          .map((m) => (
            <button className="card medicine-row" key={m.id} onClick={() => setSelected(m.id)}>
              <span className="medicine-symbol">＋</span>
              <span>
                <strong>{m.name}</strong>
                <small>
                  {m.dose || '剂量待补充'} · {m.times || '时间待补充'}
                </small>
              </span>
              <span>›</span>
            </button>
          ))}
      </div>
      {!meds.some((m) => filter === 'all' || m.status === filter) && (
        <p className="card">这里还没有药物记录，可以按医嘱添加。</p>
      )}
      <button
        className="btn-primary flow-wide"
        onClick={() =>
          setDraft({ id: crypto.randomUUID(), name: '', dose: '', purpose: '', times: '', status: 'active' })
        }
      >
        ＋ 添加药物
      </button>
    </section>
  );
}
