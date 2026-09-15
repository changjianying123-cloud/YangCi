/**
 * 释义清洗：词典导入的 meaning 常是「词性 + 多个义项」的长串
 * 例如：`v. 跑，奔跑；参加（赛跑），举行（比赛）；跑垒，持球跑动进攻；…`
 * 四选一玩耍需要短而准的中文选项，这里统一抽一个核心释义。
 *
 * 规则：
 *  1. 去掉开头的词性前缀（可叠加：`vt. vi. n.`）
 *  2. 去掉 <英，非正式> 这类语域标注
 *  3. 取第一个义项（；分割）
 *  4. 仍过长 → 按逗号再切
 *  5. 仍过长 → 硬截断
 *  6. 去掉残留的前后标点与括号
 */

const POS_PREFIX_RE = /^(\s*(?:n|v|vt|vi|adj|adv|prep|pron|conj|num|art|int|interj|aux|abbr|vt|vi)\s*\.\s*)+/i;

export function cleanMeaning(raw: unknown, maxLen = 12): string {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).trim();
  if (!s) return '';

  // 1) 去词性前缀（可能连续多个）
  let prev = '';
  let guard = 0;
  while (prev !== s && guard++ < 5) {
    prev = s;
    s = s.replace(POS_PREFIX_RE, '');
  }

  // 2) 去 <...> 语域标注
  s = s.replace(/<[^>]*>/g, '').trim();

  // 3) 去开头的括号说明（如 「（因疾病、痛苦、悲伤等）受苦」→ 保留后半）
  const parenHead = s.match(/^[（(][^）)]*[）)]\s*(.+)$/);
  if (parenHead && parenHead[1]) s = parenHead[1].trim();

  // 4) 取第一个义项
  s = s.split(/[；;]/).map((x) => x.trim()).filter(Boolean)[0] || s;

  // 5) 仍过长 → 按逗号切
  if (s.length > maxLen) {
    const sub = s.split(/[，,、]/).map((x) => x.trim()).filter(Boolean);
    s = sub[0] || s;
  }

  // 6) 硬截断
  if (s.length > maxLen) s = s.slice(0, maxLen);

  // 7) 清理残留标点/括号
  s = s.replace(/^[，,、；;。.：:\s]+/, '').replace(/[，,、；;。.：:]+$/, '').trim();
  return s;
}
