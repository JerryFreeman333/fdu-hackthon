import type { Finding, HealthMeasurement } from '../types';
import type { PersonTwin } from '../engine/personTwin';
import type { HealthKitBridgeDiagnostics } from '../adapters/HealthKitDeviceAdapter';
import type { DeviceMode } from '../config/runtime';

export interface DeviceSyncState {
  status: 'idle' | 'syncing' | 'success' | 'error';
  lastSyncAt?: string;
  error?: string;
  received: HealthMeasurement[];
  diagnostics?: HealthKitBridgeDiagnostics;
}

interface Props {
  mode: DeviceMode;
  state: DeviceSyncState;
  eventCount: number;
  findings: Finding[];
  personTwin: PersonTwin;
  onSync: () => void;
}

function valueText(item: HealthMeasurement): string {
  return `${item.value} ${item.unit}`;
}

export default function DeviceDebugPanel({ mode, state, eventCount, findings, personTwin, onSync }: Props) {
  return (
    <details className="device-debug" open={mode === 'healthkit'}>
      <summary>真实硬件验收</summary>
      <div className="mode-strip" aria-label="当前数据模式">
        <span className={`mode-pill ${mode === 'healthkit' ? 'mode-real' : 'mode-demo'}`}>
          设备：{mode === 'healthkit' ? 'HealthKit 真实模式' : 'Demo 模式'}
        </span>
      </div>
      {mode === 'demo' ? (
        <p className="muted">当前明确使用生成数据。设置 VITE_DEVICE_MODE=healthkit 后才会读取局域网桥接服务。</p>
      ) : (
        <>
          <button className="btn-primary" type="button" disabled={state.status === 'syncing'} onClick={onSync}>
            {state.status === 'syncing' ? '正在同步…' : '同步真实健康数据'}
          </button>
          <div className="debug-grid">
            <div><b>桥接状态</b><span>{state.status === 'success' ? '已连接' : state.status === 'error' ? '失败' : '等待同步'}</span></div>
            <div><b>权限请求</b><span>{state.diagnostics?.authorizationStatus ?? '尚未收到 iPhone 状态'}</span></div>
            <div><b>本次样本</b><span>{state.received.length} 条</span></div>
            <div><b>HealthEvent</b><span>{eventCount} 条</span></div>
            <div><b>Detection/Finding</b><span>{findings.length} 条</span></div>
            <div><b>Person Twin</b><span>{personTwin.asOf} 已重新生成</span></div>
          </div>
          {state.lastSyncAt && <p className="muted">最近同步：{new Date(state.lastSyncAt).toLocaleString()}</p>}
          {state.error && <div className="sync-error" role="alert">{state.error}</div>}
          {state.received.length > 0 && (
            <div className="sample-table-wrap">
              <table className="sample-table">
                <thead><tr><th>指标</th><th>原始值</th><th>时间</th><th>来源</th></tr></thead>
                <tbody>
                  {state.received.slice(-12).reverse().map((item) => (
                    <tr key={item.id}>
                      <td>{item.metric}</td>
                      <td>{valueText(item)}</td>
                      <td>{new Date(item.timestamp).toLocaleString()}</td>
                      <td>{item.source}<small>{String(item.metadata?.deviceName ?? item.metadata?.sourceName ?? '')}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </details>
  );
}
