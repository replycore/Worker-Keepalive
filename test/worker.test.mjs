// Worker-Keepalive 纯函数单测：node --test test/
// 直接 import worker.js 的命名导出（模块顶层只是字符串常量，Node 可直接执行）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTierLogPoint,
  parseSessionToken,
  b64uEncode,
  b64uDecode,
  rowToTask,
  rowToChannel,
  maxDataset,
  sumDataset,
  safeJson,
  quotaAlertDue,
} from '../worker.js';

test('isTierLogPoint：1/3/33/333… 阶梯点', () => {
  for (const n of [1, 3, 33, 333, 3333]) assert.equal(isTierLogPoint(n), true, `streak=${n}`);
  for (const n of [0, 2, 4, 6, 9, 11, 32, 34, 100]) assert.equal(isTierLogPoint(n), false, `streak=${n}`);
});

test('b64u：往返一致，不含 : 与 +/=', () => {
  for (const s of ['admin', 'user:name', '中文用户', 'a:b:c', 'x']) {
    const enc = b64uEncode(s);
    assert.match(enc, /^[A-Za-z0-9_-]+$/, `b64u alphabet: ${s}`);
    assert.equal(b64uDecode(enc), s, `roundtrip: ${s}`);
  }
});

test('parseSessionToken：新格式', () => {
  const ts = Date.now().toString();
  const tok = encodeURIComponent(b64uEncode('user:中文') + ':' + ts + ':sig');
  const p = parseSessionToken(tok);
  assert.equal(p.user, 'user:中文');
  assert.equal(p.ts, ts);
  assert.equal(p.sign, 'sig');
});

test('parseSessionToken：非法输入', () => {
  assert.equal(parseSessionToken(null), null);
  assert.equal(parseSessionToken(''), null);
  assert.equal(parseSessionToken('not-a-token'), null);
  const ts = Date.now().toString();
  const u = b64uEncode('alice');
  // 非数字 ts
  assert.equal(parseSessionToken(encodeURIComponent(u + ':abc:sig')), null);
  // 过期（7 天前）
  assert.equal(parseSessionToken(encodeURIComponent(u + ':1:sig')), null);
});

test('parseSessionToken：老格式 btoa(user:ts:sign) 兼容', () => {
  const ts = Date.now().toString();
  const old = encodeURIComponent(btoa('bob:' + ts + ':sig'));
  const p = parseSessionToken(old);
  assert.equal(p.user, 'bob');
  assert.equal(p.ts, ts);
});

test('rowToTask：缺省值与非法 notify_channels', () => {
  const t = rowToTask({ id: 1, name: 'n', url: 'https://x', notify_channels: 'not-json' });
  assert.deepEqual(t.notifyChannels, []);
  assert.equal(t.interval, 5);
  assert.equal(t.status, 'pending');
  assert.equal(t.failStreak, 0);
  const t2 = rowToTask({ id: 2, name: 'n', url: 'https://x', notify_channels: '["a","b"]', interval: 10, status: 'ok' });
  assert.deepEqual(t2.notifyChannels, ['a', 'b']);
  assert.equal(t2.interval, 10);
});

test('rowToChannel：字段映射与缺省', () => {
  const c = rowToChannel({ name: 'tg', type: 'telegram', token: 'tok', chat_id: '123' });
  assert.equal(c.chatId, '123');
  assert.equal(c.token, 'tok');
  assert.equal(c.url, '');
  assert.equal(c.owner, '');
});

test('maxDataset / sumDataset', () => {
  const data = { viewer: { accounts: [{ d1: [{ sum: { rowsRead: 10 } }, { sum: { rowsRead: 30 } }] }] } };
  assert.equal(sumDataset(data, 'd1', 'rowsRead'), 40);
  assert.equal(maxDataset(data, 'd1', 'rowsRead'), 30);
  assert.equal(sumDataset({ viewer: {} }, 'd1', 'rowsRead'), null);
  assert.equal(maxDataset(null, 'd1', 'rowsRead'), null);
  assert.equal(sumDataset({ viewer: { accounts: [{ d1: 'nope' }] } }, 'd1', 'rowsRead'), null);
});

test('safeJson：合法/非法请求体', async () => {
  const ok = await safeJson(new Request('http://x/', { method: 'POST', body: '{"a":1}' }));
  assert.deepEqual(ok, { a: 1 });
  const bad = await safeJson(new Request('http://x/', { method: 'POST', body: '{bad' }));
  assert.equal(bad, null);
});

test('quotaAlertDue：每天北京时间 8 点，一天只触发一次', () => {
  // 2026-10-05 00:00 UTC = 北京时间 08:00 → 到点
  assert.equal(quotaAlertDue(Date.UTC(2026, 9, 5, 0, 0), ''), '2026-10-05');
  // 2026-10-04 23:59 UTC = 北京时间 07:59 → 未到点
  assert.equal(quotaAlertDue(Date.UTC(2026, 9, 4, 23, 59), ''), null);
  // 今天已检查过 → 不再触发
  assert.equal(quotaAlertDue(Date.UTC(2026, 9, 5, 1, 30), '2026-10-05'), null);
  // 第二天 8 点 → 再次触发
  assert.equal(quotaAlertDue(Date.UTC(2026, 9, 6, 0, 5), '2026-10-05'), '2026-10-06');
  // 跨天边界：UTC 16:00 = 北京时间次日 00:00，未到 8 点
  assert.equal(quotaAlertDue(Date.UTC(2026, 9, 5, 16, 0), ''), null);
});
