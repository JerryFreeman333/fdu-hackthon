import { useEffect, useState, type ReactNode } from 'react';

const categories = ['体检报告', '就诊记录', '检验检查', '影像资料', '病历资料', '其他资料'];
type Archive = { id: string; name: string; category: string; date: string; file: File };
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('ankang-health-attachments', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export default function HealthArchivePage({
  children,
  onRecognize,
}: {
  children: ReactNode;
  onRecognize?: (file: File) => void;
}) {
  const [healthOpen, setHealthOpen] = useState(false);
  const [items, setItems] = useState<Archive[]>([]);
  const [category, setCategory] = useState('全部');
  const [upload, setUpload] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState(categories[0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Archive | null>(null);
  const [preview, setPreview] = useState('');
  useEffect(() => {
    let active = true;
    void database()
      .then((db) => {
        const r = db.transaction('files').objectStore('files').getAll();
        r.onsuccess = () => {
          if (active) setItems(r.result as Archive[]);
          db.close();
        };
        r.onerror = () => {
          if (active) setError('无法读取本机附件。');
          db.close();
        };
      })
      .catch(() => setError('本机附件存储不可用。'));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!selected) return;
    const url = URL.createObjectURL(selected.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selected]);
  async function save() {
    if (!file || !name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const entry: Archive = {
        id: crypto.randomUUID(),
        name: name.trim(),
        category: kind,
        date: new Date().toISOString(),
        file,
      };
      const db = await database();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      db.close();
      setItems((i) => [...i, entry]);
      setUpload(false);
      setFile(null);
      setName('');
    } catch {
      setError('附件保存失败，可能存储空间不足。请保留原文件后重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="flow-page">
      <header className="page-title-block">
        <span className="page-kicker">医疗资料，集中整理</span>
        <h1>健康档案</h1>
        <p>附件目前仅保存在这台浏览器，不会自动上传云端。</p>
      </header>
      {error && <p role="alert">{error}</p>}
      {selected ? (
        <article className="card">
          <button className="btn-secondary" onClick={() => setSelected(null)}>
            返回档案
          </button>
          <h2>{selected.name}</h2>
          <p>
            {selected.category} · {new Date(selected.date).toLocaleDateString()}
          </p>
          {selected.file.type.startsWith('image/') && (
            <img className="archive-preview" src={preview} alt={selected.name} />
          )}
          <a className="btn-secondary" href={preview} download={selected.file.name}>
            下载原文件
          </a>
        </article>
      ) : upload ? (
        <form
          className="card flow-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h2>上传新档案</h2>
          <label>
            拍照或选择图片
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  setName(f.name);
                }
              }}
            />
          </label>
          <label>
            从文件选择
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  setName(f.name);
                }
              }}
            />
          </label>
          <label>
            档案名称
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            类型
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <p>{file?.name || '尚未选择文件'}</p>
          <p className="muted">
            保存的是原始附件。识别与健康数据入档在下方“健康数据与图片识别”中单独确认，不会凭空生成报告内容。
          </p>
          <button className="btn-primary" disabled={!file || busy}>
            {busy ? '保存中…' : '保存档案'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setUpload(false)}>
            取消
          </button>
        </form>
      ) : (
        <>
          <div className="archive-grid">
            {categories.map((c, i) => (
              <button
                className={`card archive-category archive-color-${i}`}
                key={c}
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
              >
                <span aria-hidden="true">▤</span>
                <strong>{c}</strong>
                <small>{items.filter((a) => a.category === c).length} 份</small>
              </button>
            ))}
          </div>
          <div className="section-head">
            <h2>{category === '全部' ? '最近上传' : category}</h2>
            <button className="btn-secondary" onClick={() => setCategory('全部')}>
              全部
            </button>
          </div>
          {items
            .filter((a) => category === '全部' || a.category === category)
            .reverse()
            .map((a) => (
              <button className="card medicine-row" key={a.id} onClick={() => setSelected(a)}>
                <strong>{a.name}</strong>
                <span>{a.category} ›</span>
              </button>
            ))}
          {items.length === 0 && <p className="muted">还没有档案，添加第一份资料吧。</p>}
          <button className="btn-primary flow-wide" onClick={() => setUpload(true)}>
            ＋ 上传新档案
          </button>
        </>
      )}
      {file?.type.startsWith('image/') && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setHealthOpen(true);
            onRecognize?.(file);
          }}
        >
          识别已选图片（确认后入档）
        </button>
      )}
      {selected?.file.type.startsWith('image/') && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setHealthOpen(true);
            onRecognize?.(selected.file);
          }}
        >
          识别这份图片档案
        </button>
      )}
      <details className="card archive-health" open={healthOpen} onToggle={(e) => setHealthOpen(e.currentTarget.open)}>
        <summary>健康数据与图片识别</summary>
        {children}
      </details>
    </section>
  );
}
