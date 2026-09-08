import { useState } from 'react';
import type { FamilyLink, FamilySharing, UserRole } from '../types';
import { sharingLabel } from '../engine/privacy';

export default function FamilySettings({
  role,
  link,
  sharing,
  onGenerate,
  onBind,
  onGrant,
  onRevoke,
  showSharing = true,
}: {
  showSharing?: boolean;
  role: UserRole;
  link: FamilyLink | null;
  sharing: FamilySharing;
  onGenerate: () => void;
  onBind: (code: string) => string | null;
  onGrant: () => void;
  onRevoke: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  return (
    <section className="card settings-card">
      <h2>{role === 'elder' ? '与家属建立联系' : '家属端 · 绑定老人'}</h2>
      {role === 'family' && link?.status !== 'active' && (
        <p>您已进入家属端。请先绑定您要关心的老人，再由老人授权查看健康报告。</p>
      )}
      <p className="muted">
        当前只能在这台设备的同一个浏览器中切换身份体验，两台手机还不能互通。绑定后仍由您选择共享范围。
      </p>
      {link?.status === 'active' ? (
        <p className="binding-success">已绑定 · {link.displayName}</p>
      ) : role === 'elder' ? (
        <>
          {link && (
            <p className="invite-code">
              邀请码：<strong>{link.inviteCode}</strong>
            </p>
          )}
          <button className="btn-secondary" onClick={onGenerate}>
            {link ? '重新生成邀请码' : '生成家属邀请码'}
          </button>
          <p className="muted">
            记下完整邀请码（包括 AN 和年份），在本页右上角“切换身份”进入家属端后输入。请保持同一浏览器和网址。
          </p>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(onBind(code) ?? '');
          }}
        >
          <label>
            老人提供的邀请码
            <input
              value={code}
              maxLength={30}
              onChange={(e) => setCode(e.target.value)}
              placeholder="例如 AN-2026-1234"
              required
            />
          </label>
          <button className="btn-primary">确认绑定</button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
      {showSharing && (
        <>
          <hr />
          <h3>健康资料共享</h3>
          <p>{sharingLabel(sharing)}</p>
          {role === 'elder' ? (
            <>
              <p className="muted">
                开启后，之后允许共享的健康记录、报告和待办可供已绑定家属查看。历史私密记录不会补发，普通聊天不直接展示给家属。
              </p>
              <div className="form-actions">
                <button className="btn-primary" disabled={sharing === 'granted'} onClick={onGrant}>
                  以后记录也允许共享
                </button>
                <button className="btn-secondary" onClick={onRevoke}>
                  暂停全部家属共享
                </button>
              </div>
              <p className="muted">
                暂停会立即隐藏报告、通知及待办，并撤销当前单次分享；不能撤回家属此前已经看到的内容。
              </p>
            </>
          ) : (
            <p className="muted">共享由老人本人控制，请让老人在“我的”里设置。</p>
          )}
        </>
      )}
    </section>
  );
}
