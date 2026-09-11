import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { formatLocalDate, TODAY } from '../src/data/demo';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// 本地 23:59 的墙上时间必须格式化为同一天；旧的 toISOString 实现在 UTC+ 时区会退回前一天。
assert(
  formatLocalDate(new Date(2026, 8, 11, 23, 59, 59)) === '2026-09-11',
  'local 23:59 must format as the same local date',
);
assert(formatLocalDate(new Date(2026, 0, 2, 0, 0, 0)) === '2026-01-02', 'single-digit month/day must be zero padded');
assert(formatLocalDate(new Date(2026, 11, 31, 12, 0, 0)) === '2026-12-31', 'year-end date must format as-is');

// 模块级 TODAY 必须等于本进程的本地日期。
assert(TODAY === formatLocalDate(new Date()), 'TODAY must equal the current local date');

// 在 UTC+8 子进程里再次校验：无论宿主 CI 时区是什么，
// TODAY 都必须等于上海本地日期（旧实现的 TODAY 在上海恒为前一天）。
const probeScript = [
  `const { TODAY } = require(${JSON.stringify(join(__dirname, '../src/data/demo.js'))});`,
  'const now = new Date();',
  "const pad = (value) => String(value).padStart(2, '0');",
  "console.log([TODAY, now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())].join(' '));",
].join('\n');
const [todayInShanghai, shanghaiLocalDate] = execFileSync(process.execPath, ['-e', probeScript], {
  env: { ...process.env, TZ: 'Asia/Shanghai' },
})
  .toString()
  .trim()
  .split(' ');
assert(
  todayInShanghai === shanghaiLocalDate,
  `TODAY (${todayInShanghai}) must equal the Asia/Shanghai local date (${shanghaiLocalDate})`,
);

console.log('PASS: local date formatting is timezone-safe');
