import { runtimeConfig } from '../config/runtime';

export default function RuntimeModeBanner() {
  return (
    <div className="runtime-banner" role="status">
      <span className={runtimeConfig.deviceMode === 'healthkit' ? 'mode-real' : 'mode-demo'}>
        设备 {runtimeConfig.deviceMode}
      </span>
      <span className={runtimeConfig.healthVisionMode === 'real' ? 'mode-real' : 'mode-demo'}>
        图像 {runtimeConfig.healthVisionMode}
      </span>
      <span className={runtimeConfig.agentMode === 'llm' ? 'mode-real' : 'mode-demo'}>
        Agent {runtimeConfig.agentMode}
      </span>
      {runtimeConfig.deviceMode === 'healthkit' && (
        <small>人物资料仍为 Demo Profile；健康测量仅接受 source=healthkit 的真实数据。</small>
      )}
    </div>
  );
}
