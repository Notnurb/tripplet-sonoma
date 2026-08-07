// OpenSonoma relay — a thin WebSocket forwarder between Sonoma sessions
// (role "client") and paired machines (role "device").
//
// It executes NOTHING. It only:
//   - authenticates devices (device_token) and clients (Supabase JWT),
//   - keeps the `machines` row up to date (status / last_seen_at),
//   - routes exec/unlock/cancel from clients to the right device socket,
//   - routes op_started/stream/result/unlock_result back to the client socket,
//   - persists operation_logs and machine_sessions,
//   - NEVER writes a plaintext password to the database (the `password` field
//     in unlock/exec is forwarded to the device and immediately forgotten).
//
// Wire protocol: see opensonoma/protocol.py (this file mirrors those shapes).

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
// NOTE: @supabase/supabase-js is imported lazily in openDb() — it is only
// needed when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set. A static import
// here made the relay crash on boot for every deployment that doesn't use
// Supabase, even though the in-memory store below is a complete fallback.

// ---------------------------------------------------------------------------
// Protocol constants (kept in sync with opensonoma/protocol.py)
// ---------------------------------------------------------------------------
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

// Pairing alphabet mirrors opensonoma/pairing.py.
const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PAIRING_GROUP_LEN = 3;
const PAIRING_GROUPS = 2;

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const PING_INTERVAL_MS = 30000;   // ws-level keepalive ping
const STALE_SWEEP_MS = 15000;     // how often we look for stale devices
const STALE_MS = 60000;           // device heartbeat is ~20s; 3x = stale

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function log(...args) {
  process.stdout.write(`[${new Date().toISOString()}] ${args.join(' ')}\n`);
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Minimal .env loader (no extra dependency). Only fills vars not already set.
// ---------------------------------------------------------------------------
function loadEnvFile() {
  let text;
  try {
    text = fs.readFileSync(new URL('./.env', import.meta.url), 'utf8');
  } catch (e) {
    return; // no .env file — rely on the process environment
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

// ---------------------------------------------------------------------------
// Pairing-code normalization (mirrors opensonoma/pairing.normalize_pairing_code)
// ---------------------------------------------------------------------------
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
// Persistence layer — Supabase when configured, otherwise an in-memory dev
// store. Both expose the same async interface so the routing code is identical.
// ---------------------------------------------------------------------------
function createSupabaseDb(supabase) {
  return {
    mode: 'supabase',

    async authenticate(jwt /*, accountIdHint */) {
      if (!jwt) return { ok: false, error: 'missing auth_jwt' };
      try {
        const { data, error } = await supabase.auth.getUser(jwt);
        if (error || !data || !data.user) {
          return { ok: false, error: 'invalid auth token' };
        }
        return { ok: true, accountId: data.user.id };
      } catch (e) {
        return { ok: false, error: 'auth error' };
      }
    },

    async upsertMachineOnRegister(row) {
      // `row` intentionally omits account_id so an existing binding is kept.
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
      const { error } = await supabase
        .from('machines')
        .update(patch)
        .eq('device_id', deviceId);
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
        .update({
          exit_code: fields.exit_code,
          finished_at: fields.finished_at,
        })
        .eq('log_id', logId);
      if (error) throw new Error(error.message);
    },

    async upsertMachineSession(row) {
      const { error } = await supabase
        .from('machine_sessions')
        .upsert(row, { onConflict: 'session_id' });
      if (error) throw new Error(error.message);
    },
  };
}

function createMemoryDb() {
  const machines = new Map(); // device_id -> row
  const sessions = new Map(); // session_id -> row
  const logs = new Map(); // log_id -> row

  return {
    mode: 'memory',

    async authenticate(jwt, accountIdHint) {
      // Dev mode only: we cannot verify a JWT without Supabase, so we trust the
      // supplied account_id (or derive a stable id from the token).
      const accountId =
        accountIdHint || (jwt ? `dev-${String(jwt).slice(0, 16)}` : null);
      if (!accountId) {
        return { ok: false, error: 'dev mode requires account_id or auth_jwt' };
      }
      return { ok: true, accountId };
    },

    async upsertMachineOnRegister(row) {
      const existing = machines.get(row.device_id) || {};
      const merged = Object.assign(
        { account_id: null, created_at: nowIso() },
        existing,
        row, // does not include account_id, so existing binding is preserved
      );
      machines.set(row.device_id, merged);
      return merged;
    },

    async getMachineByPairingCode(code) {
      for (const row of machines.values()) {
        if (row.pairing_code === code) return row;
      }
      return null;
    },

    async getMachine(deviceId) {
      return machines.get(deviceId) || null;
    },

    async listMachines(accountId) {
      const out = [];
      for (const row of machines.values()) {
        if (row.account_id === accountId) {
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
      const row = machines.get(deviceId);
      if (row) {
        row.status = status;
        row.last_seen_at = nowIso();
      }
    },

    async touchMachine(deviceId) {
      const row = machines.get(deviceId);
      if (row) {
        row.status = 'online';
        row.last_seen_at = nowIso();
      }
    },

    async bindMachineAccount(deviceId, accountId, machineName) {
      const row = machines.get(deviceId);
      if (row) {
        row.account_id = accountId;
        if (machineName) row.machine_name = machineName;
      }
    },

    async insertOperationLog(row) {
      const logId = randomUUID();
      logs.set(logId, {
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
      const row = logs.get(logId);
      if (row) {
        row.exit_code = fields.exit_code;
        row.finished_at = fields.finished_at;
      }
    },

    async upsertMachineSession(row) {
      sessions.set(row.session_id, Object.assign({}, row));
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory routing state
// ---------------------------------------------------------------------------
const deviceSockets = new Map(); // device_id  -> ws
const clientSockets = new Map(); // session_id -> ws
const deviceTokens = new Map(); // device_id  -> device_token (first-seen wins)
const opLogIds = new Map(); // op_id      -> operation_logs.log_id

// ---------------------------------------------------------------------------
// Send helpers
// ---------------------------------------------------------------------------
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

function broadcastToAccount(accountId, obj) {
  if (!accountId) return;
  for (const ws of clientSockets.values()) {
    if (ws._accountId === accountId) send(ws, obj);
  }
}

function liveMachineView(m) {
  const sock = deviceSockets.get(m.device_id);
  return {
    device_id: m.device_id,
    machine_name: m.machine_name,
    status: sock ? 'online' : m.status,
    last_seen_at: m.last_seen_at,
    // The device's X25519 public key (base64), if it advertised one. Clients
    // seal the per-use password to this so the relay never sees plaintext.
    e2e_pubkey: (sock && sock._e2ePubKey) || m.e2e_pubkey || null,
  };
}

// Forward a device->client frame (op_started/stream/result/unlock_result/error),
// tagging it with the originating device_id.
function forwardToClient(deviceWs, msg) {
  const sessionId = msg.session_id;
  if (!sessionId) return;
  const client = clientSockets.get(sessionId);
  if (!client) return;
  send(client, Object.assign({}, msg, { device_id: deviceWs._deviceId }));
}

// ---------------------------------------------------------------------------
// Client authentication
// ---------------------------------------------------------------------------
// Set in boot() from process.env. When present, the relay verifies the Tripplet
// app's own session JWT (HS256, signed with the app's JWT_SECRET) and uses its
// `userId` claim as the authoritative account id. This is the production bridge
// between the Next app's auth and the relay — no Supabase user required.
let TRIPPLET_JWT_SECRET = '';

function b64urlToBuf(s) {
  let str = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) str += '='.repeat(4 - pad);
  return Buffer.from(str, 'base64');
}

// Verify a Tripplet HS256 session token. Returns { ok, userId } / { ok:false }.
function verifyTrippletJwt(token) {
  if (!TRIPPLET_JWT_SECRET || !token) return { ok: false };
  const parts = String(token).split('.');
  if (parts.length !== 3) return { ok: false };
  const [h, p, sig] = parts;

  let header, payload;
  try {
    header = JSON.parse(b64urlToBuf(h).toString('utf8'));
    payload = JSON.parse(b64urlToBuf(p).toString('utf8'));
  } catch (e) {
    return { ok: false };
  }
  if (!header || header.alg !== 'HS256') return { ok: false };

  const expected = createHmac('sha256', TRIPPLET_JWT_SECRET)
    .update(`${h}.${p}`)
    .digest();
  let provided;
  try {
    provided = b64urlToBuf(sig);
  } catch (e) {
    return { ok: false };
  }
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false };
  }

  // Reject expired tokens (exp is seconds since epoch, per JWT).
  if (payload.exp && Date.now() / 1000 > Number(payload.exp)) return { ok: false };
  if (!payload.userId) return { ok: false };
  return { ok: true, userId: String(payload.userId) };
}

// Resolve a client's identity. Tripplet JWT is authoritative when configured;
// otherwise fall back to the persistence layer (Supabase, or dev-trust memory).
async function authenticateClient(msg) {
  if (TRIPPLET_JWT_SECRET) {
    const r = verifyTrippletJwt(msg.auth_jwt);
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

  const known = deviceTokens.get(deviceId);
  if (known && known !== token) {
    sendError(ws, 'device_token mismatch');
    ws.close();
    return;
  }
  if (!known) deviceTokens.set(deviceId, token);

  let row = null;
  try {
    row = await db.upsertMachineOnRegister({
      device_id: deviceId,
      machine_name: msg.machine_name || deviceId,
      pairing_code: msg.pairing_code || null,
      password_hash: msg.password_hash || null, // a hash, never plaintext
      status: 'online',
      last_seen_at: nowIso(),
    });
  } catch (e) {
    log('machine upsert failed:', e.message);
  }

  // If the same device_id is already connected, retire the old socket.
  const existing = deviceSockets.get(deviceId);
  if (existing && existing !== ws) {
    try {
      existing.close();
    } catch (e) {
      /* ignore */
    }
  }

  ws._role = ROLE_DEVICE;
  ws._deviceId = deviceId;
  ws._machineName = msg.machine_name || (row && row.machine_name) || deviceId;
  ws._accountId = (row && row.account_id) || null;
  // The device's E2E public key (base64), forwarded verbatim to clients so they
  // can seal the per-use password to it. The relay only routes it; it holds no
  // private key and cannot decrypt anything sealed with it.
  ws._e2ePubKey = msg.e2e_pubkey || null;
  ws._lastSeen = Date.now();
  deviceSockets.set(deviceId, ws);

  send(ws, {
    type: T_REGISTER_ACK,
    ok: true,
    account_id: ws._accountId,
    paired: !!ws._accountId,
  });

  if (ws._accountId) {
    broadcastToAccount(ws._accountId, {
      type: T_DEVICE_STATUS,
      device_id: deviceId,
      status: 'online',
    });
  }
  log(`device registered: ${deviceId} (${ws._machineName})`);
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

  ws._role = ROLE_CLIENT;
  ws._sessionId = sessionId;
  ws._accountId = auth.accountId;
  clientSockets.set(sessionId, ws);

  let machines = [];
  try {
    machines = await db.listMachines(auth.accountId);
  } catch (e) {
    log('listMachines failed:', e.message);
  }

  send(ws, {
    type: T_REGISTER_ACK,
    ok: true,
    machines: machines.map(liveMachineView),
  });
  log(`client registered: session=${sessionId} account=${auth.accountId}`);
}

// ---------------------------------------------------------------------------
// Device -> relay messages
// ---------------------------------------------------------------------------
async function handleDeviceMessage(ws, msg) {
  ws._lastSeen = Date.now();
  switch (msg.type) {
    case T_HEARTBEAT:
      try {
        await db.touchMachine(ws._deviceId);
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
      // Unknown device frame — ignore (never crash the loop).
      break;
  }
}

async function onDeviceOpStarted(ws, msg) {
  forwardToClient(ws, msg);
  try {
    const logId = await db.insertOperationLog({
      device_id: ws._deviceId,
      account_id: ws._accountId,
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
        device_id: ws._deviceId,
        account_id: ws._accountId,
        unlocked_at: nowIso(),
        expires_at: msg.expires_at || null,
      });
    } catch (e) {
      log('upsert machine_session failed:', e.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Client -> relay messages
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
      forwardToDevice(ws, msg, T_EXEC);
      break;
    case T_UNLOCK:
      forwardToDevice(ws, msg, T_UNLOCK);
      break;
    case T_CANCEL:
      forwardToDevice(ws, msg, T_CANCEL);
      break;
    case T_UNPAIR:
      await onClientUnpair(ws, msg);
      break;
    default:
      // Unknown client frame — ignore.
      break;
  }
}

async function onClientUnpair(ws, msg) {
  const deviceId = msg.device_id;
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
  if (!machine || machine.account_id !== ws._accountId) {
    send(ws, { type: T_UNPAIR_RESULT, id: msg.id, ok: false, error: 'not authorized for this device' });
    return;
  }
  try {
    await db.bindMachineAccount(deviceId, null, null);
  } catch (e) {
    send(ws, { type: T_UNPAIR_RESULT, id: msg.id, ok: false, error: 'failed to unpair' });
    return;
  }
  const deviceWs = deviceSockets.get(deviceId);
  if (deviceWs) {
    deviceWs._accountId = null;
    send(deviceWs, { type: T_PAIRED, account_id: null, machine_name: deviceWs._machineName });
  }
  send(ws, { type: T_UNPAIR_RESULT, id: msg.id, ok: true, device_id: deviceId });
  log(`unpaired device ${deviceId} from account ${ws._accountId}`);
}

async function onClientPair(ws, msg) {
  const code = normalizePairingCode(msg.pairing_code);
  if (!code) {
    send(ws, {
      type: T_PAIR_RESULT,
      id: msg.id,
      ok: false,
      error: 'missing pairing code',
    });
    return;
  }

  let machine = null;
  try {
    machine = await db.getMachineByPairingCode(code);
  } catch (e) {
    log('getMachineByPairingCode failed:', e.message);
  }
  if (!machine) {
    send(ws, {
      type: T_PAIR_RESULT,
      id: msg.id,
      ok: false,
      error: 'no machine with that pairing code',
    });
    return;
  }

  const machineName = msg.machine_name || machine.machine_name;
  try {
    await db.bindMachineAccount(machine.device_id, ws._accountId, machineName);
  } catch (e) {
    log('bindMachineAccount failed:', e.message);
    send(ws, {
      type: T_PAIR_RESULT,
      id: msg.id,
      ok: false,
      error: 'failed to bind machine',
    });
    return;
  }

  const deviceWs = deviceSockets.get(machine.device_id);
  const online = !!deviceWs;
  if (deviceWs) {
    deviceWs._accountId = ws._accountId;
    deviceWs._machineName = machineName;
    send(deviceWs, {
      type: T_PAIRED,
      account_id: ws._accountId,
      machine_name: machineName,
    });
  }

  send(ws, {
    type: T_PAIR_RESULT,
    id: msg.id,
    ok: true,
    device_id: machine.device_id,
    machine_name: machineName,
    online,
    e2e_pubkey: (deviceWs && deviceWs._e2ePubKey) || null,
  });
  log(`paired device ${machine.device_id} -> account ${ws._accountId}`);
}

async function onClientListMachines(ws, msg) {
  let machines = [];
  try {
    machines = await db.listMachines(ws._accountId);
  } catch (e) {
    log('listMachines failed:', e.message);
  }
  send(ws, { type: T_MACHINES_LIST, machines: machines.map(liveMachineView) });
}

// Route exec/unlock/cancel from a client to the target device, stamping the
// caller's authenticated session_id so device replies route back here.
function forwardToDevice(clientWs, msg, type) {
  const deviceId = msg.device_id;
  const sessionId = clientWs._sessionId;
  if (!deviceId) {
    sendError(clientWs, 'missing device_id', msg.id);
    return;
  }

  const deviceWs = deviceSockets.get(deviceId);
  if (!deviceWs) {
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

  // Authorization: a client may only drive devices bound to its own account.
  if (!deviceWs._accountId) {
    sendError(clientWs, 'device not paired', msg.id);
    return;
  }
  if (deviceWs._accountId !== clientWs._accountId) {
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
    // Forward the end-to-end sealed password verbatim (opaque to the relay).
    if (msg.enc) out.enc = msg.enc;
  } else if (type === T_UNLOCK) {
    out = {
      type: T_UNLOCK,
      id: msg.id,
      session_id: sessionId,
      password: msg.password,
    };
    if (msg.enc) out.enc = msg.enc;
  } else {
    out = {
      type: T_CANCEL,
      id: msg.id,
      session_id: sessionId,
      target_id: msg.target_id,
    };
  }
  send(deviceWs, out);
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------
function handleConnection(ws) {
  ws.isAlive = true;
  ws._role = null;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      sendError(ws, 'invalid json');
      return;
    }
    if (!msg || typeof msg !== 'object') {
      sendError(ws, 'message must be a json object');
      return;
    }

    try {
      if (!ws._role) {
        if (msg.type !== T_REGISTER) {
          sendError(ws, 'first message must be register');
          ws.close();
          return;
        }
        await handleRegister(ws, msg);
        return;
      }
      if (ws._role === ROLE_DEVICE) {
        await handleDeviceMessage(ws, msg);
      } else {
        await handleClientMessage(ws, msg);
      }
    } catch (e) {
      log('message handler error:', e && e.message ? e.message : String(e));
      sendError(ws, 'internal relay error', msg && msg.id);
    }
  });

  ws.on('close', () => {
    handleClose(ws).catch((e) => log('close handler error:', e.message));
  });
  ws.on('error', (e) => {
    log('socket error:', e && e.message ? e.message : String(e));
  });
}

async function handleClose(ws) {
  if (ws._role === ROLE_DEVICE && ws._deviceId) {
    if (deviceSockets.get(ws._deviceId) === ws) {
      deviceSockets.delete(ws._deviceId);
      try {
        await db.setMachineStatus(ws._deviceId, 'offline');
      } catch (e) {
        log('setMachineStatus(offline) failed:', e.message);
      }
      if (ws._accountId) {
        broadcastToAccount(ws._accountId, {
          type: T_DEVICE_STATUS,
          device_id: ws._deviceId,
          status: 'offline',
        });
      }
      log(`device disconnected: ${ws._deviceId}`);
    }
  } else if (ws._role === ROLE_CLIENT && ws._sessionId) {
    if (clientSockets.get(ws._sessionId) === ws) {
      clientSockets.delete(ws._sessionId);
      log(`client disconnected: ${ws._sessionId}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
loadEnvFile();

const PORT = parseInt(process.env.PORT || '8080', 10);
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// ---------------------------------------------------------------------------
// TLS — serve the relay over wss:// directly.
//
// TLS_CERT / TLS_KEY may each be either a filesystem path OR an inline PEM
// string. When both resolve, the relay listens with `https` and the WebSocket
// endpoint is wss://. When absent, it listens with plain `http`/ws:// — fine
// behind a TLS-terminating proxy (nginx/Caddy/Cloudflare) or for localhost dev.
function readTlsMaterial(value) {
  if (!value) return '';
  if (value.includes('-----BEGIN')) return value; // inline PEM
  try {
    return fs.readFileSync(value, 'utf8');
  } catch (e) {
    log(`could not read TLS material at ${value}: ${e.message}`);
    return '';
  }
}
const TLS_CERT_PEM = readTlsMaterial(process.env.TLS_CERT || '');
const TLS_KEY_PEM = readTlsMaterial(process.env.TLS_KEY || '');
const TLS_ENABLED = !!(TLS_CERT_PEM && TLS_KEY_PEM);

const RELAY_PUBLIC_URL =
  process.env.RELAY_PUBLIC_URL ||
  `${TLS_ENABLED ? 'wss' : 'ws'}://localhost:${PORT}/ws`;

// Shared secret with the Tripplet app (its JWT_SECRET). When set, client
// sessions are authenticated by verifying the app's HS256 session token.
TRIPPLET_JWT_SECRET = process.env.TRIPPLET_JWT_SECRET || '';

// Choose the persistence layer. Supabase is loaded on demand so the relay has
// no hard dependency on it when it isn't configured.
//
// If Supabase IS configured but the package is missing we exit rather than
// silently dropping to the in-memory store: that store is dev-trust (it cannot
// verify a Supabase JWT), so degrading would turn a configured, authenticated
// relay into an unauthenticated one. Fail loudly instead.
async function openDb() {
  if (!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)) {
    log('In-memory persistence (no Supabase configured).');
    return createMemoryDb();
  }

  let createClient;
  try {
    ({ createClient } = await import('@supabase/supabase-js'));
  } catch (e) {
    log(
      'FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set, but ' +
        '@supabase/supabase-js is not installed. Run `npm install` in ' +
        'services/opensonoma-agent/relay. Refusing to fall back to the ' +
        'dev-trust in-memory store while Supabase auth is configured.',
    );
    process.exit(1);
  }

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
  const devTrust =
    'no TRIPPLET_JWT_SECRET and no Supabase — clients are DEV-TRUSTED ' +
    '(JWTs are NOT verified; any caller can claim any account_id).';
  if (process.env.NODE_ENV === 'production') {
    // Dev-trust in production means account spoofing (device theft/unpair).
    // Refuse to boot rather than silently serving an unauthenticated relay.
    log(`FATAL: ${devTrust} Set TRIPPLET_JWT_SECRET (or Supabase) before deploying.`);
    process.exit(1);
  }
  log(`WARNING: ${devTrust} Set TRIPPLET_JWT_SECRET for production.`);
}

function requestHandler(req, res) {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        service: 'opensonoma-relay',
        secure: TLS_ENABLED,
        // No device/client counts or auth mode here — those are operational
        // intel (live fleet size, whether client auth is enforced) with no
        // need to be public.
      }),
    );
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
}

const server = TLS_ENABLED
  ? https.createServer({ cert: TLS_CERT_PEM, key: TLS_KEY_PEM }, requestHandler)
  : http.createServer(requestHandler);

if (TLS_ENABLED) {
  log('TLS enabled — serving the relay over wss://.');
} else {
  log(
    'TLS not configured (serving ws://). Terminate TLS at a proxy, or set ' +
      'TLS_CERT + TLS_KEY, so production traffic is wss://.',
  );
}

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', handleConnection);

// ws-level keepalive: terminate sockets that stop answering pings.
const pingTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try {
        ws.terminate();
      } catch (e) {
        /* ignore */
      }
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (e) {
      /* ignore */
    }
  }
}, PING_INTERVAL_MS);

// Heartbeat-staleness sweep: mark devices offline if they go quiet.
const staleTimer = setInterval(async () => {
  const now = Date.now();
  for (const [deviceId, ws] of deviceSockets) {
    if (ws._lastSeen && now - ws._lastSeen > STALE_MS) {
      log(`device stale, marking offline: ${deviceId}`);
      deviceSockets.delete(deviceId);
      try {
        await db.setMachineStatus(deviceId, 'offline');
      } catch (e) {
        log('setMachineStatus(offline) failed:', e.message);
      }
      if (ws._accountId) {
        broadcastToAccount(ws._accountId, {
          type: T_DEVICE_STATUS,
          device_id: deviceId,
          status: 'offline',
        });
      }
      try {
        ws.terminate();
      } catch (e) {
        /* ignore */
      }
    }
  }
}, STALE_SWEEP_MS);

server.listen(PORT, () => {
  log(`OpenSonoma relay listening on :${PORT} (ws path /ws)`);
  log(`public url: ${RELAY_PUBLIC_URL}`);
});

async function shutdown(signal) {
  log(`received ${signal}, shutting down`);
  clearInterval(pingTimer);
  clearInterval(staleTimer);
  try {
    for (const deviceId of deviceSockets.keys()) {
      try {
        await db.setMachineStatus(deviceId, 'offline');
      } catch (e) {
        /* ignore */
      }
    }
  } catch (e) {
    /* ignore */
  }
  try {
    wss.close();
  } catch (e) {
    /* ignore */
  }
  server.close(() => process.exit(0));
  // Hard exit if close hangs.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
