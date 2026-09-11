/** Route 1 时间解析：明确日期优先，历史/模糊时间不得伪装成今天。 */

export type TimeScope = 'today' | 'yesterday' | 'lastNight' | 'daysAgo' | 'lastWeek' | 'historical' | 'unknown';

export interface ResolvedTime {
  scope: TimeScope;
  eventDate: string | null;
}

function subtractDays(today: string, days: number): string {
  return new Date(Date.parse(today) - days * 86400000).toISOString().slice(0, 10);
}

function explicitDate(clause: string, today: string): ResolvedTime | null {
  const match = clause.match(/(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})(?:日|号)?/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  if (Date.parse(date) > Date.parse(today)) return { scope: 'unknown', eventDate: null };
  return { scope: 'historical', eventDate: date };
}

export function resolveTime(clause: string, today: string): ResolvedTime {
  const explicit = explicitDate(clause, today);
  if (explicit) return explicit;

  if (/(前年|去年|上个月|以前|之前|多年前|小时候|年轻的时候|很久以前)/.test(clause)) {
    return { scope: 'historical', eventDate: null };
  }
  if (/(上周|上个星期|上礼拜)/.test(clause)) return { scope: 'lastWeek', eventDate: null };
  if (/(前天)/.test(clause)) return { scope: 'daysAgo', eventDate: subtractDays(today, 2) };
  if (/(昨晚|昨天晚上|昨天夜里|昨夜)/.test(clause)) {
    return { scope: 'lastNight', eventDate: subtractDays(today, 1) };
  }

  const hasToday = /(?:今天|刚才|刚刚|现在|目前|此刻|今天早上|今天上午|今天下午|今天晚上)/.test(clause);
  const hasYesterday = /(?:昨天|昨日)/.test(clause);
  if (
    hasToday &&
    hasYesterday &&
    /(?:比|像|没有.{0,8}(像|那么|这么|那样)|好多了|好一点|好些了|轻一点|减轻|缓解|没那么)/.test(clause)
  ) {
    return { scope: 'today', eventDate: today };
  }
  if (hasToday) return { scope: 'today', eventDate: today };
  if (hasYesterday) return { scope: 'yesterday', eventDate: subtractDays(today, 1) };
  if (/(几天前|前几天|这几天以前)/.test(clause)) return { scope: 'daysAgo', eventDate: null };
  if (/(早上|上午|下午|傍晚|晚上|中午)/.test(clause)) return { scope: 'today', eventDate: today };

  return { scope: 'unknown', eventDate: null };
}
