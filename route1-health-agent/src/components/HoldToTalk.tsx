import { useState } from 'react';
import VoiceListeningDialog, { MicrophoneIcon } from './VoiceListeningDialog';

export default function HoldToTalk({ onText, compact = false }: { onText: (text: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`hold-talk ${compact ? 'hold-talk-compact' : ''}`}>
      <button
        type="button"
        className="hold-mic"
        aria-label="开始说话"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <MicrophoneIcon />
      </button>
      <p>点击麦克风，和我说说</p>
      {open && <VoiceListeningDialog onClose={() => setOpen(false)} onText={onText} />}
    </div>
  );
}
