import { useState } from 'react';
import type { ElderProfile } from '../types';
import HoldToTalk from './HoldToTalk';

interface ProfileFormProps {
  initial: ElderProfile;
  submitLabel: string;
  onSubmit: (profile: ElderProfile) => void;
  onCancel?: () => void;
  cancelLabel?: string;
}

/**
 * 建档/编辑档案表单（评审 P0-4：身份系统）。
 * 大字号、逐项可跳过；必填只有"称呼"——其余留空不阻断，
 * 紧急联系按钮对缺失号码有降级提示，之后随时回来补。
 */
export default function ProfileForm({ initial, submitLabel, onSubmit, onCancel, cancelLabel }: ProfileFormProps) {
  const [name, setName] = useState(initial.name);
  const [sex, setSex] = useState<ElderProfile['sex']>(initial.sex ?? 'unspecified');
  const [conditions, setConditions] = useState(initial.conditions.join('、'));
  const [voiceField, setVoiceField] = useState('name');
  const [ageText, setAgeText] = useState(initial.age > 0 ? String(initial.age) : '');
  const [medications, setMedications] = useState<string[]>(initial.medications);
  const [medInput, setMedInput] = useState('');
  const [familyContact, setFamilyContact] = useState(initial.familyContact);
  const [familyPhone, setFamilyPhone] = useState(initial.familyPhone);
  const [elderPhone, setElderPhone] = useState(initial.elderPhone ?? '');
  const [doctorPhone, setDoctorPhone] = useState(initial.communityDoctorPhone ?? '');
  const [error, setError] = useState<string | null>(null);

  function addMedication() {
    const value = medInput.trim();
    if (!value) return;
    if (!medications.includes(value)) setMedications((current) => [...current, value]);
    setMedInput('');
  }

  function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('怎么称呼您？填一个称呼就好，例如"王奶奶"。');
      return;
    }
    // P1（评审 UX）：忘了点"添加"的药品不能静默丢掉——提交时自动收编输入框里的内容。
    const pendingMedication = medInput.trim();
    const finalMedications =
      pendingMedication && !medications.includes(pendingMedication) ? [...medications, pendingMedication] : medications;
    const trimmedFamilyPhone = familyPhone.trim();
    const trimmedElderPhone = elderPhone.trim();
    const trimmedDoctorPhone = doctorPhone.trim();
    const phonePattern = /^[\d\s+\-()]{5,25}$/;
    if (trimmedFamilyPhone && !phonePattern.test(trimmedFamilyPhone)) {
      setError('家属电话看起来不太对，请检查一下（只填数字、空格、+、-）。');
      return;
    }
    if (trimmedElderPhone && !phonePattern.test(trimmedElderPhone)) {
      setError('老人电话看起来不太对，请检查一下（只填数字、空格、+、-）。');
      return;
    }
    if (trimmedDoctorPhone && !phonePattern.test(trimmedDoctorPhone)) {
      setError('社区医生电话看起来不太对，请检查一下。');
      return;
    }
    const age = Number(ageText.trim());
    if (ageText.trim() && (!Number.isInteger(age) || age < 1 || age > 120)) {
      setError('请填写 1 到 120 之间的年龄，或暂时留空。');
      return;
    }
    onSubmit({
      ...initial,
      name: trimmedName,
      age: Number.isFinite(age) && age > 0 && age < 150 ? Math.round(age) : 0,
      medications: finalMedications,
      medicationRecords: initial.medicationRecords?.map((record) => ({
        ...record,
        status: finalMedications.includes(record.name) ? 'active' : 'stopped',
      })),
      sex,
      conditions: conditions
        .split(/[、，,；;\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      familyContact: familyContact.trim() || trimmedFamilyPhone || '',
      familyPhone: trimmedFamilyPhone,
      elderPhone: trimmedElderPhone || undefined,
      communityDoctorPhone: trimmedDoctorPhone || undefined,
    });
  }

  return (
    <div className="profile-form">
      <div className="card">
        <label>
          想用语音填写哪一项？
          <select value={voiceField} onChange={(e) => setVoiceField(e.target.value)}>
            <option value="name">称呼</option>
            <option value="age">年龄（请说数字）</option>
            <option value="conditions">基础病</option>
            <option value="medications">正在服用的药</option>
          </select>
        </label>
        <HoldToTalk
          compact
          onText={(text) => {
            if (voiceField === 'name') setName(text.replace(/[。！]$/, ''));
            else if (voiceField === 'age') setAgeText(text.replace(/[^0-9]/g, ''));
            else if (voiceField === 'conditions') setConditions(text);
            else setMedInput(text);
          }}
        />
        <p className="muted">语音只填写表单，请检查后再保存。</p>
      </div>
      <div className="form-section">
        <label htmlFor="profile-name">怎么称呼您？</label>
        <input
          id="profile-name"
          className="form-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：王奶奶"
          autoComplete="off"
        />
      </div>

      <div className="form-section">
        <label htmlFor="profile-age">年龄（可不填）</label>
        <input
          id="profile-age"
          className="form-input"
          inputMode="numeric"
          value={ageText}
          onChange={(event) => setAgeText(event.target.value)}
          placeholder="例如：72"
          autoComplete="off"
        />
      </div>

      <div className="form-section">
        <label htmlFor="profile-sex">性别</label>
        <select
          id="profile-sex"
          className="form-input"
          value={sex}
          onChange={(e) => setSex(e.target.value as ElderProfile['sex'])}
        >
          <option value="unspecified">暂不填写</option>
          <option value="female">女</option>
          <option value="male">男</option>
        </select>
        <label htmlFor="profile-conditions">已知基础病（按确诊情况填写）</label>
        <input
          id="profile-conditions"
          className="form-input"
          value={conditions}
          onChange={(e) => setConditions(e.target.value)}
          placeholder="例如：高血压、糖尿病；没有可以留空"
        />
      </div>
      <div className="form-section">
        <label htmlFor="profile-med">平时吃的药（可不填）</label>
        <div className="chat-input-row">
          <input
            id="profile-med"
            className="form-input"
            value={medInput}
            onChange={(event) => setMedInput(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), addMedication())}
            placeholder="例如：氨氯地平 5mg 每日一次"
            autoComplete="off"
          />
          <button className="btn-secondary" onClick={addMedication}>
            添加
          </button>
        </div>
        {medications.length > 0 && (
          <div className="med-chip-list">
            {medications.map((medication) => (
              <button
                key={medication}
                className="med-chip"
                onClick={() => setMedications((current) => current.filter((item) => item !== medication))}
                aria-label={`移除 ${medication}`}
              >
                {medication} ✕
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="form-section">
        <label htmlFor="profile-family-contact">家属称呼（可不填）</label>
        <input
          id="profile-family-contact"
          className="form-input"
          value={familyContact}
          onChange={(event) => setFamilyContact(event.target.value)}
          placeholder="例如：女儿 李芳"
          autoComplete="off"
        />
        <label htmlFor="profile-family-phone">家属电话（不填则紧急求助只保留 120）</label>
        <input
          id="profile-family-phone"
          className="form-input"
          inputMode="tel"
          value={familyPhone}
          onChange={(event) => setFamilyPhone(event.target.value)}
          placeholder="例如：13800006677"
          autoComplete="off"
        />
        <label htmlFor="profile-elder-phone">老人电话（可不填；家属端"联系老人"会拨这个号码）</label>
        <input
          id="profile-elder-phone"
          className="form-input"
          inputMode="tel"
          value={elderPhone}
          onChange={(event) => setElderPhone(event.target.value)}
          placeholder="例如：13800008888"
          autoComplete="off"
        />
        <label htmlFor="profile-doctor-phone">社区医生电话（可不填）</label>
        <input
          id="profile-doctor-phone"
          className="form-input"
          inputMode="tel"
          value={doctorPhone}
          onChange={(event) => setDoctorPhone(event.target.value)}
          placeholder="例如：021-55661234"
          autoComplete="off"
        />
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="btn-primary form-submit" onClick={handleSubmit}>
          {submitLabel}
        </button>
        {onCancel && (
          <button className="btn-secondary" onClick={onCancel}>
            {cancelLabel ?? '取消'}
          </button>
        )}
      </div>
    </div>
  );
}
