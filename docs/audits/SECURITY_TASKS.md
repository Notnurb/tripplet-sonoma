# 🚨 SECURITY FIXES - AGENT COORDINATION

> **✅ RESOLVED / HISTORICAL (closed July 2026).** This was a live coordination
> scratchpad during the security push; the work is done. Secrets rotated &
> redacted, SQL parameterized, auth hardened, the Java indexer benchmark landed
> in `services/tools/indexer-bench`. The "Agent N — WORKING/STARTED" statuses
> below are frozen history, not an open task board. Current posture lives in
> `SECURITY.md` (repo root); the closed incident report is
> `docs/security/CRITICAL_SECURITY_AUDIT.md`.

## Current Status
- **Agent 1**: READY - Awaiting task instructions from operator
- **Agent 2**: WORKING - Triplepedia indexer overhaul (Java BM25/FM-index benchmark)
- **Agent 3**: STARTED - Vulnerability fixes in `backend/`, `docker-compose.yml`, auth hardening

## Immediate Vulnerabilities to Fix (Agent 3's Lane)

### 1️⃣ URGENT: Remove Hardcoded Secrets from Version Control
**Files:** `.env`, `.env.local`, `.env.example`
**Host:** `Sonomachat-main/.env` contains actual API keys being tracked

**Actions:**
```bash
# Remove from git and rotate all secrets
rm -f Sonomachat-main/.env
rm -f Sonomachat-main/.env.example
# Update .gitignore to prevent future .env exposure
```

### 2️⃣ URGENT: Fix SQL Injection Vulnerabilities  
**Files:** 
- `Sonomachat-main/backend/services/supermemory_service.py:125-127`
- `Sonomachat-main/backend/services/agent_service.py:126-128`

**Current Pattern (VULNERABLE):**
```python
await db.execute(
    f"UPDATE user_profiles SET {', '.join(updates)} WHERE user_id = ?",
    params,
)
```

**Fix:** Use parameterized queries / string concatenation safely

### 3️⃣ CRITICAL: Secure Container Configuration
**File:** `Sonomachat-main/docker-compose.yml`

**Current Problems:**
- `POSTGRES_PASSWORD=postgres` (weak default)
- Redis running without authentication

**Solution:** Environment variables + strong passwords

### 4️⃣ MEDIUM: Vulnerability Report Cleanup
**Files:**
- `Sonomachat-main/SECURITY_AUDIT_REPORT.md` (exposes actual API keys)
- `Sonomachat-main/.claude/agent-memory/agi-safety-engineer/finding_looptrain_unauth.md` (backdoor documentation)

### 5️⃣ MEDIUM: Security Documentation
**File:** `Sonomachat-main/.claude/agent-memory/agi-safety-sarah/project_full_api_audit_2026_03_28.md`
**Issue:** Documents JWT secret in plain text

## 🎯 Agent 3's Priority (Continue Working On):

✅ **DONE:** Review and understand the vulnerability report (SECURITY_AUDIT_REPORT.md)

🚨 **BLOCKED / NEXT:**
1. **Remove hardcoded secrets from `.env`**  
   - Delete `.env` and all `.env*` files
   - Rotate all API keys

2. **Fix the SQL injection vulnerabilities**
   - Update `supermemory_service.py:125-127`
   - Update `agent_service.py:126-128`

3. **Secure docker-compose.yml**
   - Replace hardcoded passwords with environment variables
   - Configure Redis authentication

4. **Clean up vulnerability reports**
   - Delete or sanitize SECURITY_AUDIT_REPORT.md
   - Delete finding_looptrain_unauth.md

## 📋 COMMANDS TO EXECUTE (Agent 3):

```bash
# 1. SAFE: Remove secrets from version control
Sonomachat-main$ rm -f .env
Sonomachat-main$ rm -f .env.example

# 2. SAFE: Fix SQL injection in supermemory_service.py
Sonomachat-main$ edit backend/services/supermemory_service.py
# Change line 125-127 to use safe string concatenation

# 3. SAFE: Fix SQL injection in agent_service.py  
Sonomachat-main$ edit backend/services/agent_service.py
# Change line 126-128 to use safe string concatenation

# 4. SAFE: Review docker-compose.yml and secure passwords
Sonomachat-main$ cat docker-compose.yml
# Update with environment variables

# 5. SAFE: Contact me if you hit any blocker or need clarification
Sonomachat-main$ cat ISSUES.md
# See my current status and questions
```

## 🚪 When YOU (Agent 3) HIT A BLOCKER:

1. **Edit this file (SECURITY_TASKS.md)** and add a block note
2. **Ping me here (Requests/Handoffs)** with:
   - What you're working on
   - What specifically is blocking you  
   - What you need from me

## ✅ WHEN YOU (Agent 3) COMPLETE ONE SECTION:

Update your status in SECURITY_TASKS.md and move to the next priority

---
**STATUS:** Agent 3 is STARTED on vulnerability fixes. Ready to work through the security vulnerabilities listed above.

**NEXT:** Choose your first fix to start with, then coordinate if you need help with any of the changes.
