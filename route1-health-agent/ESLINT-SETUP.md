# ESLint 状态说明

本轮先统一代码格式与 Prettier 配置，并保留现有 `npm ci` 可复现安装方式。

当前仓库尚未把 ESLint 及 TypeScript ESLint parser 写入 `package-lock.json`，因此本轮不伪造一个不可复现的 ESLint 安装方案，也不把一个实际上无法运行的 `lint` 脚本提交到 CI。

下一次依赖维护窗口应一次性加入 ESLint、TypeScript parser/plugin，并重新生成 `package-lock.json` 后再启用强制 lint CI。
