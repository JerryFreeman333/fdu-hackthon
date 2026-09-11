# 路线一 TODO 清单

> 生成时间：2026-09-11
> 用途：把进度报告里"做了壳没真接"和"完全没做"的需求收敛成 4 项可执行任务
> 砍掉项：老年人社群（与"主攻路线一"定位冲突，需要多人交互，YAGNI）

---

## 总览

| # | 任务 | 原始需求 | 优先级 | 估时 | 状态 |
|---|------|---------|-------|------|------|
| 1 | 拍照录入血压计 / 血糖仪 / 体重秤 / 体检报告 | #4 + #5 | 🔴 最高 | 0.5 天 | ☐ |
| 2 | 家属 / 社区医生真实拨打按钮 | #10 + #11 | 🟡 高 | 0.5 小时 | ☑ |
| 3 | 用药提醒（CareTask 落地） | #13 | 🟡 高 | 0.5 天 | ☐ |
| 4 | LLM 开放域问答（切到 createHttpLlmAdapter） | #13 | 🟢 中 | 0.5-1 天 | ☐ |

> 砍掉项：老年人社群（#12）—— 与单 Agent 定位不符，跳过。
> 演示打磨（演示剧本 / 重置按钮 / 移动端）不在此清单，做完 #1 后单独排。

---

## 任务 1：拍照录入（OCR）🔴

**原始需求**：
- 想法.md #4：拍血压计 / 血糖仪 / 体重秤照片，自动识别数据
- 想法.md #5：拍体检报告照片，提取重要指标

**现状**：
- `src/adapters/ImageHealthScanner.ts`：接口已定义
- `src/data/demo.ts`：硬编码 `seedPhotoObservations` 演示数据
- UI：老人主页没有拍照入口

**改动点**：
1. 引入 OCR：`tesseract.js`（浏览器纯前端，无需后端）
   ```bash
   npm install tesseract.js
   ```
2. `src/adapters/ImageHealthScanner.ts`：实现真实 OCR + 数值解析（复用已有的 `src/data/normalize.ts` 正则逻辑提取血压 / 血糖 / 体重）
3. `src/components/PhotoInput.tsx`：新组件
   - 调起摄像头 / 选择图片
   - 调 OCR 提取数值
   - 让老人确认（"我看到血压 138/84，对吗？"）
   - 提交后写入 Observation
4. `src/components/ElderHome.tsx`：加一个"📷 录入数据"按钮 → 弹 PhotoInput

**验收标准**：
- [ ] 拍一张血压计照片 → 5 秒内显示"血压 138/84 mmHg，对吗？"
- [ ] 老人点确认 → 数据写入 store，下次跑检测引擎时使用
- [ ] OCR 置信度 < 0.7 时显示"看不太清，请重新拍"

**演示剧本**：评委现场拍一张血压计照片 → Agent 立刻识别 → 这就是最"哇塞"的瞬间。

---

## 任务 2：真实拨打按钮 🟡

**原始需求**：
- 想法.md #10：Agent 直接给子女发消息
- 想法.md #11：严重情况联系社区 / 社区医生 / 医院

**现状**：
- `src/components/FamilyView.tsx` 的"📞 联系老人"按钮只画了图，无真实功能
- `src/engine/escalate.ts` 没生成"拨打路径"

**改动点**（最小改动）：
1. `src/types.ts` 的 `ElderProfile` 加 `familyPhone: string`、`communityDoctorPhone?: string`
2. `src/data/demo.ts` 的 profile 补上联系电话
3. `src/components/FamilyView.tsx`：
   - "📞 联系老人"按钮 → `<a href="tel:${phone}">`
   - 新增"📞 联系社区医生"按钮（仅 urgent 显示）→ `<a href="tel:${doctorPhone}">`
4. `src/components/ReportView.tsx`：周报底部加"紧急联系"卡片

**验收标准**：
- [ ] 手机 / 模拟器点"联系老人"自动跳到拨号界面
- [ ] 桌面浏览器提示"请在手机端拨打"
- [ ] urgent 级 Finding 自动显示社区医生按钮

**估时**：30 分钟，纯 UI + tel: 协议，不引入新依赖。

---

## 任务 3：用药提醒 🟡

**原始需求**：想法.md #13 传统陪伴功能"提醒"

**现状**：
- `src/types.ts` 的 `CareTask` 类型已定义完整（含 `kind: 'medication_check'`、`dueDate`、`status`）
- `src/engine/tasks.ts`：抽象已存在
- UI：老人主页没有提醒卡片

**改动点**：
1. `src/data/demo.ts`：加几条 seed CareTask（基于老人 medications 生成）
2. `src/store/HealthRecordStore.ts`：增加 task 的 CRUD
3. `src/components/ElderHome.tsx`：加"💊 今天的药"卡片
   - 列出当天到期的 task
   - 点击标记完成（写回 store）
4. 可选：用浏览器 `Notification` API 做系统级提醒（需用户授权）
   ```ts
   if (Notification.permission === 'granted') {
     new Notification('该吃药了', { body: '氨氯地平 5mg' });
   }
   ```

**验收标准**：
- [ ] 老人主页显示"💊 今天的药"卡片，列出 medications
- [ ] 点击"已吃" → 状态变 completed，写入 store
- [ ] 浏览器通知（如果授权）

**演示剧本**：打开 demo → 看到 2 条提醒 → 点完成 → 演示闭环。

---

## 任务 4：LLM 开放域问答 🟢

**原始需求**：想法.md #13"回答生活问题"

**现状**：
- `src/engine/agent.ts` 的 `createHttpLlmAdapter(url)` 写好了
- 默认走 `ruleBasedAdapter`，LLM 通道未启用

**改动点**：
1. 准备 LLM 端点：写一个最小 Node.js BFF 转发到 OpenAI / 智谱 / DeepSeek（key 保服务端）
   ```bash
   # server/index.mjs （新文件）
   import OpenAI from 'openai';
   // POST /api/chat → 调用 LLM → 返回 { text, tags }
   ```
2. Vite 配 dev server 代理 `/api/*` 到 Node BFF
3. `src/components/ChatView.tsx`：右上角加一个切换开关"规则模式 / LLM 模式"
4. 切换后用 `createHttpLlmAdapter('/api/chat')`

**验收标准**：
- [ ] 切到 LLM 模式后，问"今天天气怎么样"也能答（开放域）
- [ ] 安全护栏仍然生效（urgent 症状仍走急救路径，不被 LLM 覆盖）
- [ ] LLM 端点失败时回退到规则模式

**注意事项**：
- 演示时**建议默认 LLM 模式**（评委一眼能看出"这是真 AI"）
- 但要保留规则模式作为 fallback（断网时仍能演示）
- 提示词要把 `AgentContext`（含 Finding、基线、主诉）喂进去，让 LLM 真的"认识"这个老人

**估时**：半天（含 LLM 端点 + UI + 提示词调试）

---

## 不做的项

- ❌ **老年人社群**（想法 #12）—— 与单 Agent 定位不符，跳过
- ❌ **路线二（3D 建模）** —— README 已说明主攻路线一
- ❌ **路线三（融合路线）** —— 同上
- ❌ **真实后端服务** —— localStorage + Node BFF 已够
- ❌ **真实手表 / 健康 App 接入** —— 健康松不需要，Demo 已能讲清故事

---

## 推荐执行顺序

1. **任务 2（30 分钟）** —— 纯 UI 改动，立刻有"真实"感
2. **任务 1（0.5 天）** —— 演示的最大爆点
3. **任务 3（0.5 天）** —— 闭环演示，体现"陪伴"价值
4. **任务 4（半天）** —— 最后做，有时间就上，没时间砍掉也不影响 demo

**总估时**：1.5 - 2 天。

---

*TODO 完成后回这里勾选，并更新进度报告。*
