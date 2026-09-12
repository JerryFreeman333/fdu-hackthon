import { useState, type ReactNode } from 'react';
import type { ElderProfile, FamilyLink } from '../types';
import type { CrossDeviceStatus } from '../hooks/useCrossDeviceSync';
import type { DataMode } from '../store/profileStore';
import ProfileForm from './ProfileForm';
import { sharingLabel } from '../engine/privacy';

interface ElderSettingsPageProps {
  profile: ElderProfile;
  familyLink: FamilyLink | null;
  syncStatus: CrossDeviceStatus;
  dataMode: DataMode;
  onProfileSave: (profile: ElderProfile) => void;
  onRequestFamilyShare: () => void;
  onRevokeFamilyShare: () => void;
  onGenerateInvite: () => void;
  onClearData: () => void;
  onSwitchRole: () => void;
  children: ReactNode;
}

export default function ElderSettingsPage({
  profile,
  familyLink,
  syncStatus,
  dataMode,
  onProfileSave,
  onRequestFamilyShare,
  onRevokeFamilyShare,
  onGenerateInvite,
  onClearData,
  onSwitchRole,
  children,
}: ElderSettingsPageProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="settings-page">
        <header className="page-title-block">
          <span className="page-kicker">个人资料</span>
          <h1>编辑我的档案</h1>
        </header>
        <section className="card">
          <ProfileForm
            initial={profile}
            submitLabel="保存档案"
            onSubmit={(next) => {
              onProfileSave(next);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <header className="page-title-block">
        <span className="page-kicker">我的</span>
        <h1>资料、家庭与隐私</h1>
        <p>您可以随时查看、修改或撤回授权。</p>
      </header>

      <section className="settings-list card">
        <button type="button" onClick={() => setEditing(true)}>
          <span>
            <strong>个人资料</strong>
            <small>
              {profile.name} · {profile.age ? `${profile.age} 岁` : '年龄未填写'}
            </small>
          </span>
          <b>›</b>
        </button>
        <div className="settings-row">
          <span>
            <strong>数据模式</strong>
            <small>{dataMode === 'demo' ? '演示数据，所有示例均有标注' : '自用模式，不注入演示数据'}</small>
          </span>
        </div>
        <div className="settings-row">
          <span>
            <strong>当前共享范围</strong>
            <small>{sharingLabel(profile.familySharing)}</small>
          </span>
          {profile.familySharing === 'granted' ? (
            <button className="inline-setting-action" type="button" onClick={onRevokeFamilyShare}>
              暂停共享
            </button>
          ) : (
            <button className="inline-setting-action" type="button" onClick={onRequestFamilyShare}>
              允许共享
            </button>
          )}
        </div>
      </section>

      <section className="card family-binding-card">
        <span className="page-kicker">家庭协同</span>
        <h2>
          {familyLink?.status === 'active' ? '已经和家人连接' : familyLink ? '等待家人输入邀请码' : '还没有绑定家人'}
        </h2>
        {familyLink?.status === 'active' ? (
          <p>
            {familyLink.relation} · {familyLink.displayName}
          </p>
        ) : familyLink ? (
          <>
            <p>请让家属输入：</p>
            <strong className="invite-code">{familyLink.inviteCode}</strong>
            <p className="muted">
              {syncStatus.mode === 'failed' ? '暂时没连上，您的记录仍安全保存在本机。' : '输入后会建立家庭协同。'}
            </p>
          </>
        ) : (
          <button className="btn-primary" type="button" onClick={onGenerateInvite}>
            生成家属邀请码
          </button>
        )}
      </section>

      <section className="card settings-technical" aria-label="服务连接状态">
        <span className="page-kicker">真实服务状态</span>
        <h2>设备、模型与同步</h2>
        <p className="muted">这里会如实显示真实连接、演示模式或失败状态。</p>
        {children}
      </section>

      <section className="settings-danger-zone">
        <button className="btn-secondary" type="button" onClick={onSwitchRole}>
          切换身份
        </button>
        <button className="danger-text-button" type="button" onClick={onClearData}>
          清空本机全部数据
        </button>
      </section>
    </div>
  );
}
