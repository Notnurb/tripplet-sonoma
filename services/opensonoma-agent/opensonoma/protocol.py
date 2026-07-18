"""Wire protocol shared by the daemon, the relay, and the Sonoma skill.

Transport: a single secure WebSocket (wss) to the Tripplet relay. Every frame is
a UTF-8 JSON object with a ``type`` field. The relay only *forwards* operational
messages between a Sonoma session (role ``client``) and a paired machine (role
``device``); it never executes anything itself.

This module is the canonical Python definition of the protocol. The Node relay
(relay/server.js) and the Sonoma skill (sonoma-skill/) implement the exact same
shapes; keep all three in sync.

----------------------------------------------------------------------------
Roles
----------------------------------------------------------------------------
  device  — the OpenSonoma daemon running on the user's machine.
  client  — a Sonoma backend session acting on behalf of the signed-in user.

----------------------------------------------------------------------------
device -> relay
----------------------------------------------------------------------------
  register      {type, role:"device", device_id, device_token, machine_name,
                 pairing_code, password_hash, version, e2e_pubkey?}
                 e2e_pubkey is a raw 32-byte X25519 public key (base64). When
                 present, a client MAY seal the per-use password to it so the
                 relay never sees plaintext (see opensonoma/e2e.py).
  heartbeat     {type}
  op_started    {type, id, session_id, kind, command, started_at}
  stream        {type, id, session_id, stream:"stdout"|"stderr", seq, data}
  result        {type, id, session_id, ok, exit_code, duration_ms,
                 started_at, finished_at, error}
  unlock_result {type, id, session_id, ok, expires_at, error}
  error         {type, id?, session_id?, message}

----------------------------------------------------------------------------
relay -> device
----------------------------------------------------------------------------
  register_ack  {type, ok, account_id, paired}
  exec          {type, id, session_id, auth:{password}, op:{kind, ...}, enc?}
  unlock        {type, id, session_id, password, enc?}
  cancel        {type, id, session_id, target_id}
  paired        {type, account_id, machine_name}

  `enc` (optional) is a sealed box {v, epk, iv, ct, tag} carrying the per-use
  password, encrypted end-to-end to the device's e2e_pubkey. When present the
  device decrypts it and ignores the plaintext `password`/`auth.password`. The
  relay forwards `enc` verbatim and cannot read it.

----------------------------------------------------------------------------
client -> relay
----------------------------------------------------------------------------
  register      {type, role:"client", account_id, session_id, auth_jwt}
  pair          {type, id, account_id, pairing_code, machine_name?}
  list_machines {type, account_id}
  unlock        {type, id, device_id, session_id, password}
  exec          {type, id, device_id, session_id, auth:{password}, op:{...}}
  cancel        {type, id, device_id, session_id, target_id}

----------------------------------------------------------------------------
relay -> client
----------------------------------------------------------------------------
  register_ack  {type, ok, machines:[...]}
  pair_result   {type, id, ok, device_id?, machine_name?, online?, error?}
  machines_list {type, machines:[{device_id, machine_name, status, last_seen_at}]}
  device_status {type, device_id, status}
  stream / result / unlock_result  (forwarded, with device_id added)
  error         {type, id?, message}
"""

from __future__ import annotations

import time
import uuid

# -- message type constants -------------------------------------------------
T_REGISTER = "register"
T_REGISTER_ACK = "register_ack"
T_HEARTBEAT = "heartbeat"
T_OP_STARTED = "op_started"
T_STREAM = "stream"
T_RESULT = "result"
T_UNLOCK = "unlock"
T_UNLOCK_RESULT = "unlock_result"
T_EXEC = "exec"
T_CANCEL = "cancel"
T_PAIR = "pair"
T_PAIR_RESULT = "pair_result"
T_PAIRED = "paired"
T_LIST_MACHINES = "list_machines"
T_MACHINES_LIST = "machines_list"
T_DEVICE_STATUS = "device_status"
T_ERROR = "error"

ROLE_DEVICE = "device"
ROLE_CLIENT = "client"

STREAM_STDOUT = "stdout"
STREAM_STDERR = "stderr"

# Operation kinds the execution engine understands.
KIND_BASH = "bash"
KIND_PYTHON = "python"
KIND_CPP = "cpp"
KIND_WEB = "web"
KIND_SEARCH = "search"
KIND_LIST_PROCESSES = "list_processes"
ALL_KINDS = (
    KIND_BASH,
    KIND_PYTHON,
    KIND_CPP,
    KIND_WEB,
    KIND_SEARCH,
    KIND_LIST_PROCESSES,
)


def new_id() -> str:
    return uuid.uuid4().hex


def now_iso() -> str:
    """UTC ISO-8601 timestamp with a trailing Z."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def now_ms() -> int:
    return int(time.time() * 1000)


# -- builders (device side) -------------------------------------------------
def register_msg(device_id, device_token, machine_name, pairing_code,
                 password_hash, version, e2e_pubkey=None):
    msg = {
        "type": T_REGISTER,
        "role": ROLE_DEVICE,
        "device_id": device_id,
        "device_token": device_token,
        "machine_name": machine_name,
        "pairing_code": pairing_code,
        "password_hash": password_hash,
        "version": version,
    }
    if e2e_pubkey:
        # Advertise the device's X25519 public key so clients can seal the
        # per-use password end-to-end (the relay never sees it).
        msg["e2e_pubkey"] = e2e_pubkey
    return msg


def heartbeat_msg():
    return {"type": T_HEARTBEAT}


def op_started_msg(op_id, session_id, kind, command):
    return {
        "type": T_OP_STARTED,
        "id": op_id,
        "session_id": session_id,
        "kind": kind,
        "command": command,
        "started_at": now_iso(),
    }


def stream_msg(op_id, session_id, stream, seq, data):
    return {
        "type": T_STREAM,
        "id": op_id,
        "session_id": session_id,
        "stream": stream,
        "seq": seq,
        "data": data,
    }


def result_msg(op_id, session_id, ok, exit_code, duration_ms,
               started_at, finished_at, error=None):
    return {
        "type": T_RESULT,
        "id": op_id,
        "session_id": session_id,
        "ok": ok,
        "exit_code": exit_code,
        "duration_ms": duration_ms,
        "started_at": started_at,
        "finished_at": finished_at,
        "error": error,
    }


def unlock_result_msg(req_id, session_id, ok, expires_at=None, error=None):
    return {
        "type": T_UNLOCK_RESULT,
        "id": req_id,
        "session_id": session_id,
        "ok": ok,
        "expires_at": expires_at,
        "error": error,
    }


def error_msg(message, msg_id=None, session_id=None):
    out = {"type": T_ERROR, "message": message}
    if msg_id is not None:
        out["id"] = msg_id
    if session_id is not None:
        out["session_id"] = session_id
    return out
