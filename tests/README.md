# Tests

## Philosophy: test what can hurt you

Coverage here is deliberately **risk-weighted, not breadth-weighted**. The
suite concentrates on the surfaces where a bug is a security incident, a data
lie, or a silent prod outage — not on presentational components:

| Suite | Guards against |
|---|---|
| `sonoma-route` | Unvalidated payloads reaching the model (every rejection branch, real `NextRequest`s) |
| `websearch-parse` + SSRF cases in `sonoma-modules` | Fetching internal/metadata hosts; ad links or non-http URLs leaking into results |
| `auth`, `dev-access` | Token forgery, tampering, expiry bypass, password rotation not invalidating sessions |
| `auth-routes`, `auth-reset-routes` | The register/login/logout/me + password-reset **handlers**: account lockout, cookie flags, user-enumeration resistance, reset tokens stored only as hashes |
| `oauth-token-route` | The OAuth 2.1 token endpoint + real PKCE S256 verification: code single-use/expiry/binding, redirect-uri match, refresh rotation, tokens stored hashed |
| `llm-backend` | Persona → backend routing (`resolveBackend`) drifting, and a missing inference key surfacing as a clean 503 instead of a confusing upstream 401 |
| `rate-limit` | Spoofed client IPs escaping limits |
| `run-python` | Fabricated "execution" output — these tests run **real CPython** and assert real stdout/tracebacks, including the kill-switch on infinite loops |
| `think-splitter`, `sonoma-stream` | Streamed tags/events split across chunk boundaries corrupting the thinking/answer split |
| `check-env` | Production builds shipping with missing secrets (the incident that actually happened once) |
| `modes`, `models`, `model-prompts` | Config drift: conflicting modes coexisting, upstream model names leaking client-side, personas losing their identity prompt |
| `validation`, `backend-fetch` | Schema bounds and backend auth headers regressing |

| `message-ui` | Rendering regressions in the chat surface: activity cards mislabeling tools, losing their timing chip, or leaking unsafe external links (jsdom + Testing Library) |

Remaining UI breadth (full shells, hooks) is exercised by the Playwright specs
(`tests/*.spec.ts`); their failures are visible in use, whereas the suites
above guard failures that are invisible until they're incidents.

## Running

```bash
npm run test:unit   # Vitest — everything in tests/unit/ (runs in CI)
npm run test:e2e    # Playwright — needs a running app + DB
```

Adding a test? If it guards a security boundary or a data-integrity invariant,
it belongs in `tests/unit/`. Keep tests real: actual `NextRequest` objects,
actual Python execution, actual HTML fixtures — mock only at network and
process boundaries.
