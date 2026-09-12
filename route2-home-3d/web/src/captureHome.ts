import './captureHome.css';

type Home = { homeId: string; status: string; message: string; modelUrl?: string; jobId?: string };
const KEY = 'ankang-route2-home-id';
const steps = ['站在房间入口，打开灯，保持镜头清晰。', '缓慢向前移动并拍摄四周，让相邻画面有重叠。', '拍到墙角、地面和主要家具；避免只站在原地旋转。', '回看视频，确认没有长时间模糊或被手指遮挡，再上传。'];

export async function captureHome() {
  document.body.innerHTML = `<main class="capture-home"><header><a href="http://127.0.0.1:5173/">‹ 返回助手</a><span>家庭空间</span></header><h1>把熟悉的家，装进手机</h1><p>按照指引拍一段视频，我们会用您拍摄的内容建立房间模型。</p><section class="capture-card"><h2>建立我的家庭空间</h2><p id="capture-instruction"></p><div class="capture-steps"></div><video id="capture-video" playsinline muted></video><p id="capture-clock"></p><div class="capture-actions"><button id="camera">打开摄像头</button><button id="record" hidden>开始拍摄</button><button id="pause" hidden>暂停</button><button id="stop" hidden>完成拍摄</button><button id="retake" hidden>重新拍摄</button></div><label class="capture-file">也可以选择手机已经拍好的视频<input id="capture-file" type="file" accept="video/mp4,video/webm,video/quicktime" /></label><button id="upload" hidden>上传并建立空间</button><p id="capture-status" role="status"></p><progress id="capture-progress" max="100" value="0" hidden></progress><button id="retry" hidden>重新处理已上传视频</button><button id="view" hidden>查看我的家庭空间</button></section><p class="capture-note">首次建议拍摄一个房间，慢慢移动。请勿攀爬或倒退拍摄，可请家人协助。视频会提交到当前连接的建模服务。</p><a href="?demo=1">查看示例空间</a></main>`;
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const assistantUrl = new URL(window.location.href); assistantUrl.port = '5173'; assistantUrl.pathname = '/'; assistantUrl.search = ''; assistantUrl.hash = '';
  document.querySelector<HTMLAnchorElement>('.capture-home header a')!.href = assistantUrl.href;
  const video = el<HTMLVideoElement>('capture-video');
  const status = el('capture-status');
  let home: Home | null = null;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let file: File | null = null;
  let preview = '';
  let chunks: Blob[] = [];
  let poll: ReturnType<typeof setTimeout> | undefined;
  let clock: ReturnType<typeof setInterval> | undefined;
  let seconds = 0;
  let disposed = false;
  let busy = false;
  const show = (id: string, visible: boolean) => { el(id).hidden = !visible; };
  const say = (message: string) => { status.textContent = message; };
  const stopStream = () => { stream?.getTracks().forEach(t => t.stop()); stream = null; };
  const clearPreview = () => { if (preview) URL.revokeObjectURL(preview); preview = ''; };
  async function request(path: string, init?: RequestInit): Promise<Home> {
    const response = await fetch('/api/route2/homes' + path, { ...init, signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '家庭空间服务暂不可用，请稍后重试');
    return data;
  }
  function display(next: Home) {
    home = next; say(next.message);
    show('retry', ['waiting_worker', 'failed'].includes(next.status));
    show('view', next.status === 'ready' && !!next.modelUrl);
    busy = ['queued', 'extracting', 'reconstructing', 'training'].includes(next.status);
    el<HTMLButtonElement>('upload').disabled = busy;
    el<HTMLButtonElement>('camera').disabled = busy;
    el<HTMLInputElement>('capture-file').disabled = busy;
    clearTimeout(poll);
    if (busy) poll = setTimeout(() => { void refresh(); }, 2500);
  }
  async function refresh() {
    if (!home || disposed) return;
    try { display(await request('/' + home.homeId)); }
    catch { say('暂时无法查询进度，正在尝试重新连接。您不需要重复上传。'); poll = setTimeout(() => { void refresh(); }, 5000); }
  }
  document.querySelector('.capture-steps')!.append(...steps.map((text, i) => {
    const button = document.createElement('button'); button.textContent = String(i + 1); button.title = text;
    button.onclick = () => { el('capture-instruction').textContent = text; document.querySelectorAll('.capture-steps button').forEach(b => b.removeAttribute('aria-current')); button.setAttribute('aria-current', 'step'); };
    if (!i) button.setAttribute('aria-current', 'step');
    return button;
  }));
  el('capture-instruction').textContent = steps[0];
  async function openCamera() {
    if (busy) return;
    stopStream(); clearPreview(); file = null; show('upload', false); show('retake', false);
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { say('此浏览器无法直接拍摄。请使用手机相机录像，然后选择视频上传；手机网页拍摄需要 HTTPS。'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (disposed) { stopStream(); return; }
      video.removeAttribute('src'); video.srcObject = stream; video.controls = false; await video.play();
      show('record', true); say('摄像头已打开。建议连续拍摄 30–90 秒，最长约 3 分钟；慢慢移动，尽量拍全房间。');
    } catch { say('无法打开摄像头，请检查权限或选择已拍好的视频。'); stopStream(); }
  }
  el('camera').onclick = () => { void openCamera(); };
  el('retake').onclick = () => { void openCamera(); };
  function review(selected: File) { stopStream(); clearPreview(); file = selected; video.srcObject = null; preview = URL.createObjectURL(selected); video.src = preview; video.controls = true; show('upload', true); show('retake', true); show('record', false); show('pause', false); show('stop', false); say('请回看视频。满意后点击上传并建立空间。'); }
  el('record').onclick = () => {
    if (!stream || recorder?.state === 'recording') return;
    try {
      const mime = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : undefined);
      chunks = []; seconds = 0;
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onerror = () => { say('录像中断，请重新拍摄。'); clearInterval(clock); stopStream(); };
      recorder.onstop = () => { clearInterval(clock); if (disposed) return; const type = recorder?.mimeType || 'video/webm'; const blob = new Blob(chunks, { type }); if (!blob.size) { say('没有录到视频，请重试。'); return; } review(new File([blob], 'room.' + (type.includes('mp4') ? 'mp4' : 'webm'), { type })); };
      recorder.start(1000); show('record', false); show('pause', true); show('stop', true);
      el<HTMLButtonElement>('camera').disabled = true; el<HTMLInputElement>('capture-file').disabled = true;
      say('正在拍摄，请按上方步骤缓慢移动。');
      clock = setInterval(() => { if (recorder?.state === 'recording') seconds++; el('capture-clock').textContent = `已拍摄 ${seconds} 秒`; if (seconds >= 180) finish(); }, 1000);
    } catch { say('无法开始录像，请使用手机相机拍摄后上传。'); stopStream(); }
  };
  function finish() { if (recorder && recorder.state !== 'inactive') recorder.stop(); el<HTMLButtonElement>('camera').disabled = false; el<HTMLInputElement>('capture-file').disabled = false; }
  el('stop').onclick = finish;
  el('pause').onclick = () => { if (recorder?.state === 'recording') { recorder.pause(); el('pause').textContent = '继续拍摄'; } else if (recorder?.state === 'paused') { recorder.resume(); el('pause').textContent = '暂停'; } };
  el<HTMLInputElement>('capture-file').onchange = e => { const selected = (e.target as HTMLInputElement).files?.[0]; if (selected) review(selected); };
  el('upload').onclick = async () => {
    if (!file || busy) return;
    if (file.size > 200 * 1024 * 1024) { say('视频超过 200 MB，请选择短一些的视频。'); return; }
    busy = true; el<HTMLButtonElement>('upload').disabled = true;
    try {
      if (!home) { home = await request('', { method: 'POST' }); localStorage.setItem(KEY, home.homeId); }
      const form = new FormData(); form.append('file', file);
      show('capture-progress', true); say('正在上传，请保持页面打开。');
      const next = await new Promise<Home>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); xhr.open('POST', `/api/route2/homes/${home!.homeId}/capture`); xhr.timeout = 600000;
        xhr.upload.onprogress = e => { if (e.lengthComputable) { el<HTMLProgressElement>('capture-progress').value = e.loaded / e.total * 100; } };
        xhr.onerror = () => reject(new Error('上传连接失败，请重试。')); xhr.ontimeout = () => reject(new Error('上传超时，请检查网络后重试。'));
        xhr.onload = () => { try { const data = JSON.parse(xhr.responseText); if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new Error(data.detail || '上传失败')); } catch { reject(new Error('服务返回异常，请重试。')); } }; xhr.send(form);
      });
      display(next); show('upload', false);
    } catch (e) { busy = false; el<HTMLButtonElement>('upload').disabled = false; say(e instanceof Error ? e.message : '上传失败，请重试。'); }
    finally { show('capture-progress', false); }
  };
  el('retry').onclick = async () => { if (!home) return; try { display(await request(`/${home.homeId}/retry`, { method: 'POST' })); } catch (e) { say(String(e)); } };
  el('view').onclick = async () => {
    if (!home?.modelUrl) return;
    say('正在加载您的房间模型…');
    try {
      const GS = await import('@mkkellogg/gaussian-splats-3d');
      const mount = document.createElement('div'); mount.className = 'capture-model'; document.body.append(mount);
      const viewer = new GS.Viewer({ rootElement: mount, sharedMemoryForWorkers: false });
      const close = document.createElement('button'); close.textContent = '返回家庭空间'; close.className = 'capture-close'; mount.append(close);
      close.onclick = () => { void viewer.dispose(); mount.remove(); };
      try { await viewer.addSplatScene(home.modelUrl, { showLoadingUI: true }); viewer.start(); say('模型已加载。物品位置需要后续确认。'); }
      catch { void viewer.dispose(); mount.remove(); throw new Error('模型加载失败，请检查文件与设备支持后重试。'); }
    } catch (e) { say(String(e)); }
  };
  window.addEventListener('pagehide', () => { disposed = true; clearTimeout(poll); clearInterval(clock); if (recorder?.state !== 'inactive') recorder?.stop(); stopStream(); clearPreview(); }, { once: true });
  const saved = localStorage.getItem(KEY);
  if (saved) { try { display(await request('/' + saved)); } catch { say('无法恢复上次空间，请检查服务连接。重新上传可建立新的空间。'); } }
}
