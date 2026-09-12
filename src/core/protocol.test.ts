import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { onMessages, send, setHandlerErrorReporter, type Msg } from './protocol';

// A fake Hyperswarm connection: writes land in `written`, and `feed()` delivers bytes.
function fakeConn() {
  const e = new EventEmitter() as any;
  e.written = [] as Msg[];
  e.write = (b: Buffer) => {
    for (const line of b.toString().split('\n')) {
      if (line.trim()) e.written.push(JSON.parse(line));
    }
  };
  e.feed = (m: unknown) => e.emit('data', Buffer.from(JSON.stringify(m) + '\n'));
  return e;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test('a handler that throws is reported instead of vanishing', async () => {
  // This is the defect that let a seller go silent: `void handler(m)` dropped the
  // rejection, so the buyer — who had already paid to open a channel — learned nothing
  // except that no reply ever came.
  const seen: Array<{ type: string; message: string }> = [];
  setHandlerErrorReporter((m, e) => seen.push({ type: m.type, message: e.message }));
  try {
    const conn = fakeConn();
    onMessages(conn, async () => { throw new Error('model failed to load'); });
    conn.feed({ type: 'sessionOpen', buyerConsumerPub: 'p', buyerWallet: '0x1', epoch: '0' });
    await settle();

    assert.equal(seen.length, 1, 'the throw was swallowed');
    assert.equal(seen[0]!.type, 'sessionOpen');
    assert.match(seen[0]!.message, /model failed to load/);
  } finally {
    setHandlerErrorReporter(() => {});
  }
});

test('a synchronous throw is reported too', async () => {
  const seen: string[] = [];
  setHandlerErrorReporter((_m, e) => seen.push(e.message));
  try {
    const conn = fakeConn();
    onMessages(conn, () => { throw new Error('sync boom'); });
    conn.feed({ type: 'quoteReq', buyerConsumerPub: 'p', buyerWallet: '0x1' });
    await settle();
    assert.deepEqual(seen, ['sync boom']);
  } finally {
    setHandlerErrorReporter(() => {});
  }
});

test('a handler that succeeds reports nothing', async () => {
  const seen: string[] = [];
  setHandlerErrorReporter((_m, e) => seen.push(e.message));
  try {
    const conn = fakeConn();
    onMessages(conn, async (m) => { if (m.type === 'sessionProbe') send(conn, { type: 'sessionProbeAck', ok: true }); });
    conn.feed({ type: 'sessionProbe', buyerWallet: '0x1' });
    await settle();
    assert.deepEqual(seen, []);
    assert.deepEqual(conn.written, [{ type: 'sessionProbeAck', ok: true }]);
  } finally {
    setHandlerErrorReporter(() => {});
  }
});

test('framing survives two messages arriving in one chunk', async () => {
  const got: string[] = [];
  const conn = fakeConn();
  onMessages(conn, (m) => { got.push(m.type); });
  conn.emit('data', Buffer.from(
    JSON.stringify({ type: 'sessionProbe', buyerWallet: '0x1' }) + '\n' +
    JSON.stringify({ type: 'drawAck', cumulative: '1' }) + '\n',
  ));
  await settle();
  assert.deepEqual(got, ['sessionProbe', 'drawAck']);
});

test('a malformed line is skipped without killing the stream', async () => {
  const got: string[] = [];
  const conn = fakeConn();
  onMessages(conn, (m) => { got.push(m.type); });
  conn.emit('data', Buffer.from('{not json\n' + JSON.stringify({ type: 'drawAck', cumulative: '1' }) + '\n'));
  await settle();
  assert.deepEqual(got, ['drawAck'], 'a bad line must not stop later messages');
});
