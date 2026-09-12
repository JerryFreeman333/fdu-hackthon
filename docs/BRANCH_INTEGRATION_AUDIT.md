# 剩余分支整合审计（2026-09-13）

## 范围与原则

以远端 main 的 e1fe5a2 为基线，审查 73 个非 main 远端分支，比较 ancestry、git cherry 补丁等价、文件差异及回归测试，而非只按“领先 main 的提交数”决定是否合并。用户原有工作目录和运行中的 UI 未被覆盖，工作在独立 integrate-remaining worktree 完成。未删除任何分支。

本次采用 cherry-pick 和选择性迁移：吸收有效改动，不把过时 UI、旧隐私模型和旧摄像入口整分支覆盖回主线。因此 GitHub 可能仍显示来源分支“未合并”，这不代表其中有用功能没有进入 main。

## 实际吸收内容

- Route1：多人家庭主体归属、跨句日期继承、绝对日期解析（拒绝无效及未来日期），增加回归测试。
- Route2：Vite 6.4.3（来源 09ce86b，迁移提交 9d79d16）、真实输入参数校验、导出模型完整性清单。
- Route2：仅用路线范围证据评估风险；缺失覆盖证据为未知而非安全；复扫结果必须来自同一家庭的新快照，并连续关联旧快照，不能仅凭 riskIds 缺失自动关闭风险。
- Route2：路径端点歧义、低置信度、演示数据及阻塞端点拒绝认证；旧路线认证不能套用到另一条推算路径。
- Route2：修复异步离线提示覆盖用户刚选中的找药结果；显式演示不混用真实模型。
- Route2：适配当前协议的 8 项隔离浏览器黑箱与 CI；修复 Python 后端测试 discover 包根目录。
- Route1：使用已有 Prettier 3.5.3 配置进行机械格式化。原主线 format:check 有 217 个文件失败；大量文件差异为此产生，不是再次改 UI。

## 验证结果与边界

| 检查 | 结果 |
| --- | --- |
| Route1 单元/回归测试 | 373/373 通过 |
| Route1 类型检查、生产构建、安全扫描 | 通过 |
| Route1 family-management-browser / demo-filled-browser | 两套通过：新导航、药物跨 tab、档案持久化、权限隔离等 |
| Route2 Web 单元测试 | 29/29 通过 |
| Route2 类型检查、生产构建 | 通过；大包体积提示非阻断 |
| Route2 隔离浏览器黑箱 | 8/8 通过 |
| Route2 Python semantic / backend | 33/33 与 10/10 通过 |
| Route1 旧 test:browser | 未通过：仍查找已改名的“打开 AI 助手”，当前入口为“打字聊天” |
| 其他历史 Route1 UI 黑箱 | 未完整重跑，部分仍依赖旧页面结构，不声称全 CI 绿 |

限制：浏览器隔离黑箱主动模拟 API 离线，验证失败处理与演示交互，不等于真实云端/GPU 训练、微信登录、麦克风、HealthKit 真机或跨设备联调通过。生产 worker 必须提供真实 homeId/captureId/reconstructionId/version 等来源数据；旧快照没有来源仍可呈现待处理行动，但不得自动宣称复扫消除风险。不得为通过检查伪造来源信息。现有旧 UI 测试需另行迁移，不能为迎合旧定位器回退已确认的新 UI。

## 全部分支处理清单

“独有补丁”来自 git cherry，不等于缺失功能数。祖先分支记为 —。

| 远端分支 | 独有补丁 | 处理 | 理由 |
| --- | ---: | --- | --- |
| `codex/route1-elder-ux` | 1 | 不整分支合并 | 旧 UI/交互架构已被用户确认的四页 UI 取代，整合会覆盖现有页面与连接。 |
| `feat/frontend-redesign-b` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `feat/route1-chat-ux-hardening` | 24 | 不整分支合并 | 旧 UI/交互架构已被用户确认的四页 UI 取代，整合会覆盖现有页面与连接。 |
| `feat/route1-real-image-parser` | 1 | 实现已覆盖 | RealImageHealthParser 核心已在主线；不为提交历史重复引入旧版本。 |
| `fix/route1-nlp-safety-hardening` | 0 | 补丁等价 | git cherry 无独有补丁；无需重复合并历史。 |
| `fix/route1-numeric-and-code-quality` | 13 | 不整分支合并 | 旧数值/正则实现与现有安全解析冲突，保留主线数值与血压回归。 |
| `phase1-hardening` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `phase1-qa-cleanup` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `phase1-user-diagnostic-fixes` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `refactor/route1-data-layer` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `refactor/route1-data-layer-v2` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `refactor/route1-data-layer-v3` | 0 | 补丁等价 | git cherry 无独有补丁；无需重复合并历史。 |
| `route1-bp-blackbox-hardening-2026-09-10` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route1-context-memory` | 23 | 不整分支合并 | 旧上下文实现；主线已有更新的上下文、修正和隔离测试，避免旧实现回退。 |
| `route1-current-blackbox-audit-2026-09-10` | 44 | 选择性整合 | 补入协调多人归属及跨句时间继承的回归与修复；保留主线 dyspnea 标签及新版 UI。 |
| `route1-final-verify-2026-09-09` | 145 | 不整分支合并 | 历史安全实现与当前持久化隔离、授权及新 UI 架构冲突；保留主线更新的修正与回归测试。 |
| `route1-multifact` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route1-natural-language-core` | 7 | 不整分支合并 | 旧拆句/人物模块不能直接替换现有多事实和血压保护；缺失多人/时间能力已通过选择性补丁补齐。 |
| `route1-repair-2026-09-09` | 4 | 不整分支合并 | 旧修复与当前实现重复或被后续版本取代；保留主线授权、隐私和交互实现及对应测试。 |
| `route1-security-hardening-2026-09-09` | 137 | 不整分支合并 | 历史安全实现与当前持久化隔离、授权及新 UI 架构冲突；保留主线更新的修正与回归测试。 |
| `route1-self-correction` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route1-subject-attribution` | 13 | 不整分支合并 | 旧拆句/人物模块不能直接替换现有多事实和血压保护；缺失多人/时间能力已通过选择性补丁补齐。 |
| `route1-subject-attribution-ci` | 10 | 不整分支合并 | 旧拆句/人物模块不能直接替换现有多事实和血压保护；缺失多人/时间能力已通过选择性补丁补齐。 |
| `route1-time-understanding` | 78 | 选择性整合 | 提取绝对日期解析，补充无效日期、未来日期及跨句覆盖校验；不覆盖现有血压逗号保护与多事实解析。 |
| `route1/ci-clean-final-2026-09-08` | 2 | 不整分支合并 | 旧 CI、审计说明或格式分支；按当前配置执行格式化，不恢复旧 UI 定位器、过时触发分支或自动写仓库流程。 |
| `route1/ci-final-smoke-2026-09-08` | 2 | 不整分支合并 | 旧 CI、审计说明或格式分支；按当前配置执行格式化，不恢复旧 UI 定位器、过时触发分支或自动写仓库流程。 |
| `route1/ci-format-auto-2026-09-08` | 2 | 不整分支合并 | 旧 CI、审计说明或格式分支；按当前配置执行格式化，不恢复旧 UI 定位器、过时触发分支或自动写仓库流程。 |
| `route1/ci-green-blackbox-2026-09-08` | 104 | 不整分支合并 | 旧 CI、审计说明或格式分支；按当前配置执行格式化，不恢复旧 UI 定位器、过时触发分支或自动写仓库流程。 |
| `route1/ci-verification-2026-09-08` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route1/final-audit-ci-2-2026-09-08` | 1 | 不整分支合并 | 旧 CI、审计说明或格式分支；按当前配置执行格式化，不恢复旧 UI 定位器、过时触发分支或自动写仓库流程。 |
| `route1/final-audit-ci-2026-09-08` | 1 | 不整分支合并 | 旧 CI、审计说明或格式分支；按当前配置执行格式化，不恢复旧 UI 定位器、过时触发分支或自动写仓库流程。 |
| `route1/final-ci` | 108 | 选择性整合 | 提取绝对日期解析，补充无效日期、未来日期及跨句覆盖校验；不覆盖现有血压逗号保护与多事实解析。 |
| `route1/final-clean-ci-2026-09-08` | 1 | 不整分支合并 | 旧 CI、审计说明或格式分支；按当前配置执行格式化，不恢复旧 UI 定位器、过时触发分支或自动写仓库流程。 |
| `route1/final-green` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route1/final-hardening-2026-09-07` | 35 | 不整分支合并 | 旧修复与当前实现重复或被后续版本取代；保留主线授权、隐私和交互实现及对应测试。 |
| `route1/fix-rhetorical-negation-fall` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route1/fix-rhetorical-negation-fall-patch` | 35 | 不整分支合并 | 多个别名指向同一旧历史；正式反问否定修复已在主线，避免旧解析器和隐私逻辑倒退。 |
| `route1/fix-rhetorical-negation-fall-patch2` | 35 | 不整分支合并 | 多个别名指向同一旧历史；正式反问否定修复已在主线，避免旧解析器和隐私逻辑倒退。 |
| `route1/fix-rhetorical-negation-fall-patch3` | 35 | 不整分支合并 | 多个别名指向同一旧历史；正式反问否定修复已在主线，避免旧解析器和隐私逻辑倒退。 |
| `route1/fix-rhetorical-negation-fall-patch4` | 35 | 不整分支合并 | 多个别名指向同一旧历史；正式反问否定修复已在主线，避免旧解析器和隐私逻辑倒退。 |
| `route1/fix-rhetorical-negation-fall-temp` | 35 | 不整分支合并 | 多个别名指向同一旧历史；正式反问否定修复已在主线，避免旧解析器和隐私逻辑倒退。 |
| `route1/fix-rhetorical-negation-fall-temp2` | 35 | 不整分支合并 | 多个别名指向同一旧历史；正式反问否定修复已在主线，避免旧解析器和隐私逻辑倒退。 |
| `route1/format-audit-final-2026-09-08` | 4 | 不整分支合并 | 旧 CI、审计说明或格式分支；按当前配置执行格式化，不恢复旧 UI 定位器、过时触发分支或自动写仓库流程。 |
| `route1/healthkit-main-port` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route1/healthkit-port-hardening` | 3 | 选择性整合 | Vite 6.4.3 安全升级 cherry-pick；HealthKit 字段强化主线已覆盖，保留更新的自动同步与诊断。 |
| `route1/notification-delivery` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route1/patch-event-date` | 35 | 不整分支合并 | 多个别名指向同一旧历史；正式反问否定修复已在主线，避免旧解析器和隐私逻辑倒退。 |
| `route1/patch-event-date-2` | 35 | 不整分支合并 | 多个别名指向同一旧历史；正式反问否定修复已在主线，避免旧解析器和隐私逻辑倒退。 |
| `route2-3d-home-safety` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route2-family-action-loop` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route2-hardening-2026-09-09` | 50 | 选择性整合 | 补入路线风险证据、快照来源与复扫连续性校验，适配当前后端协议；缺证据禁止自动消除风险。 |
| `route2-hometwin-hardening` | 2 | 无需整合 | 对比后的测试差异以格式为主，相关防护在当前实现中已存在。 |
| `route2-personalized-clearance` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route2-personalized-clearance-final` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route2-personalized-clearance-final2` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route2-personalized-clearance-v2` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route2-personalized-clearance-v2b` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route2-personalized-clearance-v2c` | 6 | 核心已覆盖 / 补测试 | 现有 PersonHome 功能保留；相关风险证据回归随 hardening 整合，不重放旧实现。 |
| `route2-personalized-clearance-v2d` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route2-personalized-clearance-v2e` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route2-personalized-clearance-v2f` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route2-personalized-clearance-v2g` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route2-personalized-clearance-v2h` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route2-route-fallback` | 2 | 选择性整合 | 补入真实输入校验、模型导出清单；不替换新版摄像采集入口为旧展示页面。 |
| `route2-surface-costmap` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route2-surface-costmap-v2` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route2-walkability-hardening` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `route2/blackbox-audit-20260911` | 6 | 选择性整合 | 迁移隔离式 8 项浏览器黑箱到当前入口，支持 Windows/Linux 并加入 Route2 CI。 |
| `tmp-check` | — | 已在主线 | 提交已被 origin/main 包含，不重复合并。 |
| `tmp-route1-prettier-inspect-2026-09-10` | 17 | 不整分支合并 | 旧 CI、审计说明或格式分支；按当前配置执行格式化，不恢复旧 UI 定位器、过时触发分支或自动写仓库流程。 |
| `verify-route1-blackbox-20260910` | 1 | 不整分支合并 | 旧 CI、审计说明或格式分支；按当前配置执行格式化，不恢复旧 UI 定位器、过时触发分支或自动写仓库流程。 |
| `verify-route1-blackbox-final-20260910` | 9 | 不整分支合并 | 旧 CI、审计说明或格式分支；按当前配置执行格式化，不恢复旧 UI 定位器、过时触发分支或自动写仓库流程。 |
| `verify-route1-managed-chromium-20260910` | 1 | 不整分支合并 | 旧 CI、审计说明或格式分支；按当前配置执行格式化，不恢复旧 UI 定位器、过时触发分支或自动写仓库流程。 |

## 后续注意

不删除来源分支；不要因为 GitHub 仍显示未合并就把旧代码全部 merge。优先修订 Route1 旧浏览器验收脚本，再补真实硬件与云端建模验收。演示数据、真实用户资料及权限隔离继续沿用当前主线，未上传新个人附件、视频、模型或真实环境变量。

