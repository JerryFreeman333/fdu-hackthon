import { useState } from 'react';
import type { ElderProfile } from '../types';

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
  const [ageText, setAgeText] = useState(initial.age > 0 ? String(initial.age) : '');
  const [medications, setMedications] = useState<string[]>(initial.medications);
  const [medInput, setMedInput] = useState('');
  const [familyContact, setFamilyContact] = useState(initial.familyContact);
  const [familyPhone, setFamilyPhone] = useState(initial.familyPhone);
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
    const trimmedFamilyPhone = familyPhone.trim();
    const trimmedDoctorPhone = doctorPhone.trim();
    const phonePattern = /^[\d\s+\-()]{5,25}$/;
    if (trimmedFamilyPhone && !phonePattern.test(trimmedFamilyPhone)) {
      setError('家属电话看起来不太对，请检查一下（只填数字、空格、+、-）。');
      return;
    }
    if (trimmedDoctorPhone && !phonePattern.test(trimmedDoctorPhone)) {
      setError('社区医生电话看起来不太对，请检查一下。');
      return;
    }
    const age = Number(ageText.trim());
    onSubmit({
      ...initial,
      name: trimmedName,
      age: Number.isFinite(age) && age > 0 && age < 150 ? Math.round(age) : 0,
      medications,
      familyContact: familyContact.trim() || trimmedFamilyPhone || '',
      familyPhone: trimmedFamilyPhone,
      communityDoctorPhone: trimmedDoctorPhone || undefined,
    });
  }

  return (
    <div className="profile-form">
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
