import type { ChatMessage, ElderProfile } from '../types';
import type { DataMode } from '../store/profileStore';
import ChatView from './ChatView';

interface ElderAssistantPageProps {
  chat: ChatMessage[];
  onSend: (text: string) => void | Promise<void>;
  quickInputs: string[];
  profile: ElderProfile;
  dataMode: DataMode;
  onBack: () => void;
  onEmergency: () => void;
}

export default function ElderAssistantPage({
  chat,
  onSend,
  quickInputs,
  profile,
  dataMode,
  onBack,
  onEmergency,
}: ElderAssistantPageProps) {
  return (
    <div className="assistant-page">
      <header className="subpage-header assistant-page-header">
        <button className="back-button" type="button" onClick={onBack} aria-label="返回首页">
          <span aria-hidden="true">‹</span>
        </button>
        <div>
          <strong>AI 助手</strong>
          <span>有事，和我说说</span>
        </div>
        <button className="assistant-sos" type="button" onClick={onEmergency}>
          求助
        </button>
      </header>
      <div className="assistant-listening-card">
        <span className="assistant-orb">
          <span className="voice-mic-mark" aria-hidden="true" />
        </span>
        <div>
          <strong>点“说话”后，我会认真听</strong>
          <span>识别结果会先放进输入框，确认后再发送。</span>
        </div>
      </div>
      <ChatView
        id="elder-chat"
        chat={chat}
        onSend={onSend}
        quickInputs={quickInputs}
        profile={profile}
        deviceNote={dataMode}
      />
    </div>
  );
}
