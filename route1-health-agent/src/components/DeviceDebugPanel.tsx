import type { Finding, HealthMeasurement } from '../types';
import type { PersonTwin } from '../engine/personTwin';
import type { HealthKitBridgeDiagnostics } from '../adapters/HealthKitDeviceAdapter';
import type { DeviceMode } from '../config/runtime';

export interface DeviceSyncState {
  status: 'idle' | 'syncing' | 'success' | 'error';
  lastSyncAt?: string;
  lastCheckedAt?: string;
  autoPolling?: boolean;
  lastTrigger?: 'manual' | 'automatic';
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

function provenanceText(item: HealthMeasurement): string {
  return [
    item.metadata?.sourceName,
    item.metadata?.deviceName,
    item.metadata?.aggregation,
    item.metadata?.healthkitUuid ?? item.id,
  ]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join(' · ');
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
            <div>
              <b>模式</b>
              <span>HealthKit</span>
            </div>
            <div>
              <b>桥接状态</b>
              <span>{state.status === 'success' ? '已连接' : state.status === 'error' ? '失败' : '等待同步'}</span>
            </div>
            <div>
              <b>自动检测</b>
              <span>{state.autoPolling ? '已开启（每 7 秒）' : '未开启'}</span>
            </div>
            <div>
              <b>Bridge revision</b>
              <span>{state.diagnostics?.revision ?? '尚无'}</span>
            </div>
            <div>
              <b>权限请求</b>
              <span>{state.diagnostics?.authorizationStatus ?? '尚未收到 iPhone 状态'}</span>
            </div>
            <div>
              <b>最近上传时间</b>
              <span>
                {state.diagnostics?.receivedAt ? new Date(state.diagnostics.receivedAt).toLocaleString() : '尚无'}
              </span>
            </div>
            <div>
              <b>数据生成时间</b>
              <span>
                {state.diagnostics?.generatedAt ? new Date(state.diagnostics.generatedAt).toLocaleString() : '尚无'}
              </span>
            </div>
            <div>
              <b>设备</b>
              <span>{state.diagnostics?.deviceName ?? '尚无'}</span>
            </div>
            <div>
              <b>数据新鲜度</b>
              <span>
                {state.diagnostics?.freshness === 'fresh'
                  ? `有效（≤ ${state.diagnostics.maxAgeMinutes ?? 30} 分钟）`
                  : state.diagnostics?.freshness === 'stale'
                    ? '旧数据，不可用于本轮验收'
                    : '尚未确认'}
              </span>
            </div>
            <div>
              <b>样本数</b>
              <span>{state.received.length} 条</span>
            </div>
            <div>
              <b>HealthEvent</b>
              <span>{eventCount} 条</span>
            </div>
            <div>
              <b>Detection/Finding</b>
              <span>{findings.length} 条</span>
            </div>
            <div>
              <b>Person Twin 最近刷新</b>
              <span>
                {state.lastSyncAt
                  ? `${new Date(state.lastSyncAt).toLocaleString()}（asOf ${personTwin.asOf}）`
                  : '等待真实同步'}
              </span>
            </div>
          </div>
          {state.lastSyncAt && <p className="muted">最近同步：{new Date(state.lastSyncAt).toLocaleString()}</p>}
          {state.lastCheckedAt && (
            <p className="muted">
              最近检测：{new Date(state.lastCheckedAt).toLocaleString()}
              {state.lastTrigger ? ` · 最近刷新由${state.lastTrigger === 'automatic' ? '自动检测' : '手动按钮'}触发` : ''}
            </p>
          )}
          {state.error && (
            <div className="sync-error" role="alert">
              {state.error}
            </div>
          )}
          <p className="sync-error">未使用 Demo 数据替代</p>
          {state.received.length > 0 && (
            <div className="sample-table-wrap">
              <table className="sample-table">
                <thead>
                  <tr>
                    <th>指标</th>
                    <th>原始值</th>
                    <th>时间</th>
                    <th>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {state.received
                    .slice(-12)
                    .reverse()
                    .map((item) => (
                      <tr key={item.id}>
                        <td>{item.metric}</td>
                        <td>{valueText(item)}</td>
                        <td>{new Date(item.timestamp).toLocaleString()}</td>
                        <td>
                          {item.source}
                          <small>{provenanceText(item)}</small>
                        </td>
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
