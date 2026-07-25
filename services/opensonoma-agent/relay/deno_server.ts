// OpenSonoma relay — Deno Deploy entry point.
//
// Same protocol and routing logic as server.js, ported off Node's `ws`/`http`
// onto Deno's native Deno.serve + WebSocket upgrade, so it can run on Deno
// Deploy's free tier (no card required, connections stay open — unlike
// Vercel's request/response functions).
//
// Deno Deploy env vars (set in the dashboard, no .env file support here):
//   PORT               — ignored by Deploy (it manages the listener), kept for parity
//   RELAY_PUBLIC_URL    — e.g. wss://relay.getsonoma.lol/ws
//   TRIPPLET_JWT_SECRET — same value as the Next app's JWT_SECRET
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — optional, for persistence
//
// Caveat: Deno Deploy may run more than one isolate under sustained load,
// and the routing Maps below are process-local — a device and its client
// could in theory land on different isolates. For this relay's traffic
// (personal pairing, not high concurrency) Deploy keeps a single instance
// warm in practice. If this becomes unreliable under real load, migrate the
// Maps to Deno Deploy's cross-isolate BroadcastChannel/KV.

// @ts-nocheck — this file runs on Deno, not under the repo's Node/TS toolchain.

const T_REGISTER = 'register';
const T_REGISTER_ACK = 'register_ack';
const T_HEARTBEAT = 'heartbeat';
const T_OP_STARTED = 'op_started';
const T_STREAM = 'stream';
const T_RESULT = 'result';
const T_UNLOCK = 'unlock';
const T_UNLOCK_RESULT = 'unlock_result';
const T_EXEC = 'exec';
const T_CANCEL = 'cancel';
const T_PAIR = 'pair';
const T_PAIR_RESULT = 'pair_result';
const T_PAIRED = 'paired';
const T_LIST_MACHINES = 'list_machines';
const T_MACHINES_LIST = 'machines_list';
const T_DEVICE_STATUS = 'device_status';
const T_UNPAIR = 'unpair';
const T_UNPAIR_RESULT = 'unpair_result';
const T_ERROR = 'error';

const ROLE_DEVICE = 'device';
const ROLE_CLIENT = 'client';

const PAIRING_GROUP_LEN = 3;
const PAIRING_GROUPS = 2;

const STALE_SWEEP_MS = 15000;
const STALE_MS = 60000;

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePairingCode(value) {
  if (!value) return '';
  const cleaned = String(value)
    .toUpperCase()
    .split('')
    .filter((ch) => /[A-Z0-9]/.test(ch))
    .join('');
  const full = PAIRING_GROUP_LEN * PAIRING_GROUPS;
  if (cleaned.length === full) {
    const parts = [];
    for (let i = 0; i < full; i += PAIRING_GROUP_LEN) {
      parts.push(cleaned.slice(i, i + PAIRING_GROUP_LEN));
    }
    return parts.join('-');
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// Persistence layer (Supabase when configured, otherwise in-memory dev store)
// ---------------------------------------------------------------------------
function createSupabaseDb(supabase) {
  return {
    mode: 'supabase',
    async authenticate(jwt) {
      if (!jwt) return { ok: false, error: 'missing auth_jwt' };
      try {
        const { data, error } = await supabase.auth.getUser(jwt);
        if (error || !data || !data.user) return { ok: false, error: 'invalid auth token' };
        return { ok: true, accountId: data.user.id };
      } catch (e) {
        return { ok: false, error: 'auth error' };
      }
    },
    async upsertMachineOnRegister(row) {
      const { data, error } = await supabase
        .from('machines')
        .upsert(row, { onConflict: 'device_id' })
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async getMachineByPairingCode(code) {
      const { data, error } = await supabase
        .from('machines')
        .select('*')
        .eq('pairing_code', code)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    },
    async getMachine(deviceId) {
      const { data, error } = await supabase
        .from('machines')
        .select('*')
        .eq('device_id', deviceId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    },
    async listMachines(accountId) {
      const { data, error } = await supabase
        .from('machines')
        .select('device_id, machine_name, status, last_seen_at')
        .eq('account_id', accountId);
      if (error) throw new Error(error.message);
      return data || [];
    },
    async setMachineStatus(deviceId, status) {
      const { error } = await supabase
        .from('machines')
        .update({ status, last_seen_at: nowIso() })
        .eq('device_id', deviceId);
      if (error) throw new Error(error.message);
    },
    async touchMachine(deviceId) {
      const { error } = await supabase
        .from('machines')
        .update({ status: 'online', last_seen_at: nowIso() })
        .eq('device_id', deviceId);
      if (error) throw new Error(error.message);
    },
    async bindMachineAccount(deviceId, accountId, machineName) {
      const patch = { account_id: accountId };
      if (machineName) patch.machine_name = machineName;
      const { error } = await supabase.from('machines').update(patch).eq('device_id', deviceId);
      if (error) throw new Error(error.message);
    },
    async insertOperationLog(row) {
      const { data, error } = await supabase
        .from('operation_logs')
        .insert({
          device_id: row.device_id,
          account_id: row.account_id,
          kind: row.kind,
          command: row.command,
          started_at: row.started_at,
          exit_code: null,
          finished_at: null,
        })
        .select('log_id')
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? data.log_id : null;
    },
    async finishOperationLog(logId, fields) {
      const { error } = await supabase
        .from('operation_logs')
        .update({ exit_code: fields.exit_code, finished_at: fields.finished_at })
        .eq('log_id', logId);
      if (error) throw new Error(error.message);
    },
    async upsertMachineSession(row) {
      const { error } = await supabase.from('machine_sessions').upsert(row, { onConflict: 'session_id' });
      if (error) throw new Error(error.message);
    },
  };
}

// Deno Deploy runs multiple isolates (per region) with NO shared process
// memory — a plain in-process Map here would make "machines" invisible to
// whichever isolate a given request happens to land on (this is exactly what
// caused pairing/exec to work "sometimes"). Deno KV is Deploy's built-in
// globally-consistent store, free on every plan, so machine/session/log rows
// go there instead. Live WebSocket routing (the actual device/client sockets)
// still can't be shared this way — see sendToDevice/sendToClient below, which
// use BroadcastChannel to hop to whichever isolate holds the live socket.
function createKvDb(kv) {
  const machinesKey = (deviceId) => ['machines', deviceId];
  const sessionsKey = (sessionId) => ['machine_sessions', sessionId];
  const logsKey = (logId) => ['operation_logs', logId];

  return {
    mode: 'kv',
    async authenticate(jwt, accountIdHint) {
      const accountId = accountIdHint || (jwt ? `dev-${String(jwt).slice(0, 16)}` : null);
      if (!accountId) return { ok: false, error: 'dev mode requires account_id or auth_jwt' };
      return { ok: true, accountId };
    },
    async upsertMachineOnRegister(row) {
      const existing = (await kv.get(machinesKey(row.device_id))).value || {};
      const merged = Object.assign({ account_id: null, created_at: nowIso() }, existing, row);
      await kv.set(machinesKey(row.device_id), merged);
      return merged;
    },
    async getMachineByPairingCode(code) {
      for await (const entry of kv.list({ prefix: ['machines'] })) {
        if (entry.value && entry.value.pairing_code === code) return entry.value;
      }
      return null;
    },
    async getMachine(deviceId) {
      return (await kv.get(machinesKey(deviceId))).value || null;
    },
    async listMachines(accountId) {
      const out = [];
      for await (const entry of kv.list({ prefix: ['machines'] })) {
        const row = entry.value;
        if (row && row.account_id === accountId) {
          out.push({
            device_id: row.device_id,
            machine_name: row.machine_name,
            status: row.status,
            last_seen_at: row.last_seen_at,
          });
        }
      }
      return out;
    },
    async setMachineStatus(deviceId, status) {
      const row = (await kv.get(machinesKey(deviceId))).value;
      if (row) {
        row.status = status;
        row.last_seen_at = nowIso();
        await kv.set(machinesKey(deviceId), row);
      }
    },
    async touchMachine(deviceId) {
      const row = (await kv.get(machinesKey(deviceId))).value;
      if (row) {
        row.status = 'online';
        row.last_seen_at = nowIso();
        await kv.set(machinesKey(deviceId), row);
      }
    },
    async bindMachineAccount(deviceId, accountId, machineName) {
      const row = (await kv.get(machinesKey(deviceId))).value;
      if (row) {
        row.account_id = accountId;
        if (machineName) row.machine_name = machineName;
        await kv.set(machinesKey(deviceId), row);
      }
    },
    async insertOperationLog(row) {
      const logId = crypto.randomUUID();
      await kv.set(logsKey(logId), {
        log_id: logId,
        device_id: row.device_id,
        account_id: row.account_id,
        kind: row.kind,
        command: row.command,
        started_at: row.started_at,
        exit_code: null,
        finished_at: null,
      });
      return logId;
    },
    async finishOperationLog(logId, fields) {
      const row = (await kv.get(logsKey(logId))).value;
      if (row) {
        row.exit_code = fields.exit_code;
        row.finished_at = fields.finished_at;
        await kv.set(logsKey(logId), row);
      }
    },
    async upsertMachineSession(row) {
      await kv.set(sessionsKey(row.session_id), Object.assign({}, row));
    },
  };
}

// ---------------------------------------------------------------------------
// Routing state
// ---------------------------------------------------------------------------
const deviceSockets = new Map();
const clientSockets = new Map();
const opLogIds = new Map();
const socketMeta = new WeakMap(); // ws -> mutable per-connection state

function meta(ws) {
  let m = socketMeta.get(ws);
  if (!m) {
    m = {};
    socketMeta.set(ws, m);
  }
  return m;
}

function send(ws, obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(obj));
    return true;
  } catch (e) {
    log('send error:', e.message);
    return false;
  }
}

function sendError(ws, message, id) {
  const out = { type: T_ERROR, message };
  if (id !== undefined && id !== null) out.id = id;
  send(ws, out);
}

// ---------------------------------------------------------------------------
// Cross-isolate routing. Deno Deploy runs one isolate per region with no
// shared memory — deviceSockets/clientSockets only ever hold the sockets that
// literally connected to THIS isolate. A device on the "ord" isolate and a
// client request landed on "ams" would otherwise never find each other. This
// BroadcastChannel fans a message out to every isolate; only the one that
// actually holds the target socket (checked locally) delivers it — so the
// isolate that already has it locally just sends directly and never
// broadcasts, which avoids double delivery.
// ---------------------------------------------------------------------------
const bc = new BroadcastChannel('opensonoma-relay');
bc.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.kind === 'to-device') {
    const ws = deviceSockets.get(msg.deviceId);
    if (ws) send(ws, msg.frame);
  } else if (msg.kind === 'to-client') {
    const ws = clientSockets.get(msg.sessionId);
    if (ws) send(ws, msg.frame);
  } else if (msg.kind === 'to-account') {
    for (const ws of clientSockets.values()) {
      if (meta(ws).accountId === msg.accountId) send(ws, msg.frame);
    }
  }
};

function sendToDevice(deviceId, frame) {
  const ws = deviceSockets.get(deviceId);
  if (ws) {
    send(ws, frame);
    return;
  }
  bc.postMessage({ kind: 'to-device', deviceId, frame });
}

function sendToClient(sessionId, frame) {
  const ws = clientSockets.get(sessionId);
  if (ws) {
    send(ws, frame);
    return;
  }
  bc.postMessage({ kind: 'to-client', sessionId, frame });
}

function broadcastToAccount(accountId, obj) {
  if (!accountId) return;
  // Deno Deploy's BroadcastChannel delivers to every isolate INCLUDING the
  // sender, so posting once and letting the shared bc.onmessage handler (which
  // checks local clientSockets) do the matching send covers this isolate's
  // own sessions too — no separate local loop needed here.
  bc.postMessage({ kind: 'to-account', accountId, frame: obj });
}

function liveMachineView(m) {
  // `status`/`last_seen_at` come from Deno KV, kept fresh by register/
  // heartbeat/close across every isolate — no need to check a local socket
  // map that only reflects this one isolate's connections.
  const sock = deviceSockets.get(m.device_id);
  return {
    device_id: m.device_id,
    machine_name: m.machine_name,
    status: m.status,
    last_seen_at: m.last_seen_at,
    e2e_pubkey: (sock && meta(sock).e2ePubKey) || m.e2e_pubkey || null,
  };
}

function forwardToClient(deviceWs, msg) {
  const sessionId = msg.session_id;
  if (!sessionId) return;
  sendToClient(sessionId, Object.assign({}, msg, { device_id: meta(deviceWs).deviceId }));
}

// ---------------------------------------------------------------------------
// Client authentication (Tripplet HS256 JWT, verified via SubtleCrypto)
// ---------------------------------------------------------------------------
let TRIPPLET_JWT_SECRET = '';
let trippletHmacKey = null; // CryptoKey, set in boot()

function b64urlToBytes(s) {
  let str = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) str += '='.repeat(4 - pad);
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function verifyTrippletJwt(token) {
  if (!trippletHmacKey || !token) return { ok: false };
  const parts = String(token).split('.');
  if (parts.length !== 3) return { ok: false };
  const [h, p, sig] = parts;

  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  } catch (e) {
    return { ok: false };
  }
  if (!header || header.alg !== 'HS256') return { ok: false };

  let sigBytes;
  try {
    sigBytes = b64urlToBytes(sig);
  } catch (e) {
    return { ok: false };
  }

  const valid = await crypto.subtle.verify(
    'HMAC',
    trippletHmacKey,
    sigBytes,
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!valid) return { ok: false };

  if (payload.exp && Date.now() / 1000 > Number(payload.exp)) return { ok: false };
  if (!payload.userId) return { ok: false };
  return { ok: true, userId: String(payload.userId) };
}

async function authenticateClient(msg) {
  if (TRIPPLET_JWT_SECRET) {
    const r = await verifyTrippletJwt(msg.auth_jwt);
    if (r.ok) return { ok: true, accountId: r.userId };
    return { ok: false, error: 'invalid or missing Tripplet session token' };
  }
  return db.authenticate(msg.auth_jwt, msg.account_id);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
async function handleRegister(ws, msg) {
  if (msg.role === ROLE_DEVICE) return handleDeviceRegister(ws, msg);
  if (msg.role === ROLE_CLIENT) return handleClientRegister(ws, msg);
  sendError(ws, 'register requires role "device" or "client"');
  ws.close();
}

async function handleDeviceRegister(ws, msg) {
  const deviceId = msg.device_id;
  const token = msg.device_token;
  if (!deviceId || !token) {
    sendError(ws, 'device register requires device_id and device_token');
    ws.close();
    return;
  }

  // device_token mismatch must be checked against KV (cross-isolate), not a
  // local Map — a device re-registering on a different region's isolate would
  // otherwise never see its own prior token and mismatch detection would
  // silently do nothing.
  let existingRow = null;
  try {
    existingRow = await db.getMachine(deviceId);
  } catch (e) {
    log('getMachine (register) failed:', e.message);
  }
  if (existingRow && existingRow.device_token && existingRow.device_token !== token) {
    sendError(ws, 'device_token mismatch');
    ws.close();
    return;
  }

  let row = null;
  try {
    row = await db.upsertMachineOnRegister({
      device_id: deviceId,
      machine_name: msg.machine_name || deviceId,
      pairing_code: msg.pairing_code || null,
      password_hash: msg.password_hash || null,
      device_token: token,
      e2e_pubkey: msg.e2e_pubkey || null,
      status: 'online',
      last_seen_at: nowIso(),
    });
  } catch (e) {
    log('machine upsert failed:', e.message);
  }

  const existing = deviceSockets.get(deviceId);
  if (existing && existing !== ws) {
    try {
      existing.close();
    } catch (e) {
      /* ignore */
    }
  }

  const m = meta(ws);
  m.role = ROLE_DEVICE;
  m.deviceId = deviceId;
  m.machineName = msg.machine_name || (row && row.machine_name) || deviceId;
  m.accountId = (row && row.account_id) || null;
  m.e2ePubKey = msg.e2e_pubkey || null;
  m.lastSeen = Date.now();
  deviceSockets.set(deviceId, ws);

  send(ws, { type: T_REGISTER_ACK, ok: true, account_id: m.accountId, paired: !!m.accountId });

  if (m.accountId) {
    broadcastToAccount(m.accountId, { type: T_DEVICE_STATUS, device_id: deviceId, status: 'online' });
  }
  log(`device registered: ${deviceId} (${m.machineName})`);
}

async function handleClientRegister(ws, msg) {
  const sessionId = msg.session_id;
  if (!sessionId) {
    sendError(ws, 'client register requires session_id');
    ws.close();
    return;
  }

  const auth = await authenticateClient(msg);
  if (!auth.ok) {
    send(ws, { type: T_REGISTER_ACK, ok: false, error: auth.error, machines: [] });
    ws.close();
    return;
  }

  const m = meta(ws);
  m.role = ROLE_CLIENT;
  m.sessionId = sessionId;
  m.accountId = auth.accountId;
  clientSockets.set(sessionId, ws);

  let machines = [];
  try {
    machines = await db.listMachines(auth.accountId);
  } catch (e) {
    log('listMachines failed:', e.message);
  }

  send(ws, { type: T_REGISTER_ACK, ok: true, machines: machines.map(liveMachineView) });
  log(`client registered: session=${sessionId} account=${auth.accountId}`);
}

// ---------------------------------------------------------------------------
// Device -> relay
// ---------------------------------------------------------------------------
async function handleDeviceMessage(ws, msg) {
  meta(ws).lastSeen = Date.now();
  switch (msg.type) {
    case T_HEARTBEAT:
      try {
        await db.touchMachine(meta(ws).deviceId);
      } catch (e) {
        log('touchMachine failed:', e.message);
      }
      break;
    case T_OP_STARTED:
      await onDeviceOpStarted(ws, msg);
      break;
    case T_STREAM:
      forwardToClient(ws, msg);
      break;
    case T_RESULT:
      await onDeviceResult(ws, msg);
      break;
    case T_UNLOCK_RESULT:
      await onDeviceUnlockResult(ws, msg);
      break;
    case T_ERROR:
      forwardToClient(ws, msg);
      break;
    default:
      break;
  }
}

async function onDeviceOpStarted(ws, msg) {
  forwardToClient(ws, msg);
  try {
    const logId = await db.insertOperationLog({
      device_id: meta(ws).deviceId,
      account_id: meta(ws).accountId,
      kind: msg.kind || null,
      command: msg.command || null,
      started_at: msg.started_at || nowIso(),
    });
    if (logId && msg.id) opLogIds.set(msg.id, logId);
  } catch (e) {
    log('insert operation_log failed:', e.message);
  }
}

async function onDeviceResult(ws, msg) {
  forwardToClient(ws, msg);
  const logId = msg.id ? opLogIds.get(msg.id) : null;
  if (logId) {
    try {
      await db.finishOperationLog(logId, {
        exit_code: msg.exit_code === undefined ? null : msg.exit_code,
        finished_at: msg.finished_at || nowIso(),
      });
    } catch (e) {
      log('finish operation_log failed:', e.message);
    }
    opLogIds.delete(msg.id);
  }
}

async function onDeviceUnlockResult(ws, msg) {
  forwardToClient(ws, msg);
  if (msg.ok && msg.session_id) {
    try {
      await db.upsertMachineSession({
        session_id: msg.session_id,
        device_id: meta(ws).deviceId,
        account_id: meta(ws).accountId,
        unlocked_at: nowIso(),
        expires_at: msg.expires_at || null,
      });
    } catch (e) {
      log('upsert machine_session failed:', e.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Client -> relay
// ---------------------------------------------------------------------------
async function handleClientMessage(ws, msg) {
  switch (msg.type) {
    case T_PAIR:
      await onClientPair(ws, msg);
      break;
    case T_LIST_MACHINES:
      await onClientListMachines(ws, msg);
      break;
    case T_EXEC:
      await forwardToDevice(ws, msg, T_EXEC);
      break;
    case T_UNLOCK:
      await forwardToDevice(ws, msg, T_UNLOCK);
      break;
    case T_CANCEL:
      await forwardToDevice(ws, msg, T_CANCEL);
      break;
    case T_UNPAIR:
      await onClientUnpair(ws, msg);
      break;
    default:
      break;
  }
}

async function onClientUnpair(ws, msg) {
  const deviceId = msg.device_id;
  const m = meta(ws);
  if (!deviceId) {
    send(ws, { type: T_UNPAIR_RESULT, id: msg.id, ok: false, error: 'missing device_id' });
    return;
  }
  let machine = null;
  try {
    machine = await db.getMachine(deviceId);
  } catch (e) {
    log('getMachine failed:', e.message);
  }
  if (!machine || machine.account_id !== m.accountId) {
    send(ws, { type: T_UNPAIR_RESULT, id: msg.id, ok: false, error: 'not authorized for this device' });
    return;
  }
  try {
    await db.bindMachineAccount(deviceId, null, null);
  } catch (e) {
    send(ws, { type: T_UNPAIR_RESULT, id: msg.id, ok: false, error: 'failed to unpair' });
    return;
  }
  const localDeviceWs = deviceSockets.get(deviceId);
  if (localDeviceWs) meta(localDeviceWs).accountId = null;
  sendToDevice(deviceId, { type: T_PAIRED, account_id: null, machine_name: machine.machine_name });
  send(ws, { type: T_UNPAIR_RESULT, id: msg.id, ok: true, device_id: deviceId });
  log(`unpaired device ${deviceId} from account ${m.accountId}`);
}

async function onClientPair(ws, msg) {
  const code = normalizePairingCode(msg.pairing_code);
  const m = meta(ws);
  if (!code) {
    send(ws, { type: T_PAIR_RESULT, id: msg.id, ok: false, error: 'missing pairing code' });
    return;
  }

  let machine = null;
  try {
    machine = await db.getMachineByPairingCode(code);
  } catch (e) {
    log('getMachineByPairingCode failed:', e.message);
  }
  if (!machine) {
    send(ws, { type: T_PAIR_RESULT, id: msg.id, ok: false, error: 'no machine with that pairing code' });
    return;
  }

  const machineName = msg.machine_name || machine.machine_name;
  try {
    await db.bindMachineAccount(machine.device_id, m.accountId, machineName);
  } catch (e) {
    log('bindMachineAccount failed:', e.message);
    send(ws, { type: T_PAIR_RESULT, id: msg.id, ok: false, error: 'failed to bind machine' });
    return;
  }

  const online = machine.status === 'online';
  const localDeviceWs = deviceSockets.get(machine.device_id);
  if (localDeviceWs) {
    const dm = meta(localDeviceWs);
    dm.accountId = m.accountId;
    dm.machineName = machineName;
  }
  sendToDevice(machine.device_id, { type: T_PAIRED, account_id: m.accountId, machine_name: machineName });

  send(ws, {
    type: T_PAIR_RESULT,
    id: msg.id,
    ok: true,
    device_id: machine.device_id,
    machine_name: machineName,
    online,
    e2e_pubkey: (localDeviceWs && meta(localDeviceWs).e2ePubKey) || machine.e2e_pubkey || null,
  });
  log(`paired device ${machine.device_id} -> account ${m.accountId}`);
}

async function onClientListMachines(ws, msg) {
  let machines = [];
  try {
    machines = await db.listMachines(meta(ws).accountId);
  } catch (e) {
    log('listMachines failed:', e.message);
  }
  send(ws, { type: T_MACHINES_LIST, machines: machines.map(liveMachineView) });
}

// Async + KV-backed rather than a local deviceSockets lookup: the client
// request for this op can land on any isolate, so "is it offline" and "does
// this account own it" must be answered from the cross-isolate KV row, not
// from whatever this one isolate happens to have a local socket for.
async function forwardToDevice(clientWs, msg, type) {
  const deviceId = msg.device_id;
  const sessionId = meta(clientWs).sessionId;
  if (!deviceId) {
    sendError(clientWs, 'missing device_id', msg.id);
    return;
  }

  let machine = null;
  try {
    machine = await db.getMachine(deviceId);
  } catch (e) {
    log('getMachine (forwardToDevice) failed:', e.message);
  }

  const offline = !machine || machine.status !== 'online';
  if (offline) {
    if (type === T_EXEC) {
      send(clientWs, {
        type: T_RESULT,
        id: msg.id,
        session_id: sessionId,
        device_id: deviceId,
        ok: false,
        exit_code: null,
        duration_ms: 0,
        started_at: nowIso(),
        finished_at: nowIso(),
        error: 'device offline',
      });
    } else if (type === T_UNLOCK) {
      send(clientWs, {
        type: T_UNLOCK_RESULT,
        id: msg.id,
        session_id: sessionId,
        device_id: deviceId,
        ok: false,
        expires_at: null,
        error: 'device offline',
      });
    } else {
      sendError(clientWs, 'device offline', msg.id);
    }
    return;
  }

  if (!machine.account_id) {
    sendError(clientWs, 'device not paired', msg.id);
    return;
  }
  if (machine.account_id !== meta(clientWs).accountId) {
    sendError(clientWs, 'not authorized for this device', msg.id);
    return;
  }

  let out;
  if (type === T_EXEC) {
    out = {
      type: T_EXEC,
      id: msg.id,
      session_id: sessionId,
      auth: msg.auth || { password: msg.password },
      op: msg.op,
    };
    if (msg.enc) out.enc = msg.enc;
  } else if (type === T_UNLOCK) {
    out = { type: T_UNLOCK, id: msg.id, session_id: sessionId, password: msg.password };
    if (msg.enc) out.enc = msg.enc;
  } else {
    out = { type: T_CANCEL, id: msg.id, session_id: sessionId, target_id: msg.target_id };
  }
  sendToDevice(deviceId, out);
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------
function handleConnection(ws) {
  const m = meta(ws);
  m.role = null;

  ws.addEventListener('message', async (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (e) {
      sendError(ws, 'invalid json');
      return;
    }
    if (!msg || typeof msg !== 'object') {
      sendError(ws, 'message must be a json object');
      return;
    }

    try {
      if (!m.role) {
        if (msg.type !== T_REGISTER) {
          sendError(ws, 'first message must be register');
          ws.close();
          return;
        }
        await handleRegister(ws, msg);
        return;
      }
      if (m.role === ROLE_DEVICE) {
        await handleDeviceMessage(ws, msg);
      } else {
        await handleClientMessage(ws, msg);
      }
    } catch (e) {
      log('message handler error:', e && e.message ? e.message : String(e));
      sendError(ws, 'internal relay error', msg && msg.id);
    }
  });

  ws.addEventListener('close', () => {
    handleClose(ws).catch((e) => log('close handler error:', e.message));
  });
  ws.addEventListener('error', (e) => {
    log('socket error:', e && e.message ? e.message : String(e));
  });
}

async function handleClose(ws) {
  const m = meta(ws);
  if (m.role === ROLE_DEVICE && m.deviceId) {
    if (deviceSockets.get(m.deviceId) === ws) {
      deviceSockets.delete(m.deviceId);
      try {
        await db.setMachineStatus(m.deviceId, 'offline');
      } catch (e) {
        log('setMachineStatus(offline) failed:', e.message);
      }
      if (m.accountId) {
        broadcastToAccount(m.accountId, { type: T_DEVICE_STATUS, device_id: m.deviceId, status: 'offline' });
      }
      log(`device disconnected: ${m.deviceId}`);
    }
  } else if (m.role === ROLE_CLIENT && m.sessionId) {
    if (clientSockets.get(m.sessionId) === ws) {
      clientSockets.delete(m.sessionId);
      log(`client disconnected: ${m.sessionId}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const RELAY_PUBLIC_URL = Deno.env.get('RELAY_PUBLIC_URL') || 'wss://relay.getsonoma.lol/ws';

TRIPPLET_JWT_SECRET = Deno.env.get('TRIPPLET_JWT_SECRET') || '';
if (TRIPPLET_JWT_SECRET) {
  trippletHmacKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(TRIPPLET_JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

async function openDb() {
  if (!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)) {
    log('Deno KV persistence (no Supabase configured) — consistent across regions/isolates.');
    const kv = await Deno.openKv();
    return createKvDb(kv);
  }
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  log('Supabase persistence enabled');
  return createSupabaseDb(supabase);
}

const db = await openDb();

if (TRIPPLET_JWT_SECRET) {
  log('Client auth: Tripplet session JWT (HS256) verification ENABLED.');
} else if (db.mode === 'supabase') {
  log('Client auth: Supabase JWT verification.');
} else {
  log('WARNING: no TRIPPLET_JWT_SECRET and no Supabase — clients are DEV-TRUSTED.');
}

// Stale-device sweep.
setInterval(async () => {
  const now = Date.now();
  for (const [deviceId, ws] of deviceSockets) {
    const m = meta(ws);
    if (m.lastSeen && now - m.lastSeen > STALE_MS) {
      log(`device stale, marking offline: ${deviceId}`);
      deviceSockets.delete(deviceId);
      try {
        await db.setMachineStatus(deviceId, 'offline');
      } catch (e) {
        log('setMachineStatus(offline) failed:', e.message);
      }
      if (m.accountId) {
        broadcastToAccount(m.accountId, { type: T_DEVICE_STATUS, device_id: deviceId, status: 'offline' });
      }
      try {
        ws.close();
      } catch (e) {
        /* ignore */
      }
    }
  }
}, STALE_SWEEP_MS);

const PORT = parseInt(Deno.env.get('PORT') || '8000', 10);

Deno.serve({ port: PORT }, (req) => {
  const url = new URL(req.url);

  if (url.pathname === '/' || url.pathname === '/health') {
    return Response.json({
      ok: true,
      service: 'opensonoma-relay',
      mode: db.mode,
      secure: true,
      devices: deviceSockets.size,
      clients: clientSockets.size,
      public_url: RELAY_PUBLIC_URL,
    });
  }

  if (url.pathname === '/ws') {
    if (req.headers.get('upgrade') !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleConnection(socket);
    return response;
  }

  return Response.json({ ok: false, error: 'not found' }, { status: 404 });
});

log(`OpenSonoma relay (Deno) starting — public url: ${RELAY_PUBLIC_URL}`);
