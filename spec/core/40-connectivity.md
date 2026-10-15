# 40 — Connectivity and the sync engine

All network I/O happens in **one** sync engine per client. It is a single
sequential loop: no parallel requests, no separate send path. The precise
cycle below is what makes the two clients behave identically.

## Engine cycle (normative pseudocode)

```
engine run (while logged in):
  failures := 0
  hasMore  := false
  loop:
    # Phase A: flush (REQ-OUTBOX-*)
    while outbox not empty:
      r := POST head                       # timeout 10 s
      if r is network error / timeout / 5xx: goto FAILED
      if r is 200/201: apply REQ-OUTBOX-002
      if r is 400/409: apply REQ-OUTBOX-004
      markOnline(); failures := 0
    # Phase B: one sync request (REQ-SYNC-*)
    w := hasMore ? 0 : 25
    r := GET after=cursor wait=w            # timeout w + 10 s; may be aborted by wake
    if r was aborted by wake: continue loop # not a failure; state unchanged
    if r is network error / timeout / non-200: goto FAILED
    merge r (REQ-SYNC-002/003); hasMore := r.hasMore
    markOnline(); failures := 0
    continue loop
  FAILED:
    markOffline()
    sleep BACKOFF[min(failures, 3)]          # interruptible by wake
    failures := failures + 1
    continue loop

BACKOFF = [1 s, 2 s, 4 s, 8 s]
```

## Requirements

- **REQ-CONN-001** [client] The connection state is `online` or `offline`. It is `offline` when the engine starts. `markOnline()` / `markOffline()` set it, and the UI reflects every change (REQ-UI-003). The state means only "did my most recent request reach the server". Platform connectivity APIs MUST NOT set it directly.
- **REQ-CONN-002** [client] Each cycle runs Phase A (flush the whole outbox) **before** Phase B (one sync request). After any successful request the engine continues immediately, with no delay.
  - Consequence (the reconnect contract): on reconnect a client delivers **all** of its queued messages first, then receives what it missed. That sync includes its own just-sent messages, which are upserted, not duplicated.
- **REQ-CONN-003** [client] A failed request means: a network error, connection reset, timeout, a 5xx, or a non-200 response to a sync request. It sets the state to `offline` and sleeps `BACKOFF[min(failures, 3)]` before the next cycle. The schedule is therefore 1 s, 2 s, 4 s, 8 s, 8 s, …
- **REQ-CONN-004** [client] Any request that reaches the server and returns an HTTP response other than 5xx (including 400/409 to a POST) sets the state to `online` and resets `failures` to 0.
- **REQ-CONN-005** [client] **Wake** interrupts the engine's current wait:
  - **During a backoff sleep:** the sleep ends immediately and a new cycle starts. `failures` is **not** reset.
  - **During a Phase B long-poll:** the request is aborted client-side and a new cycle starts. The abort is **not** a failure, so the state is unchanged.
  - **During Phase A:** nothing happens. A message enqueued meanwhile is picked up by the running flush loop.

  Wake sources: a persisted send (REQ-SEND-004), the platform reporting that the network became available, and the app returning to the foreground.
- **REQ-CONN-006** [client] Timeouts:
  - POST: 10 s total.
  - GET: `wait` + 10 s total.
  - Connecting: at most 10 s.

  A timeout is a failure (REQ-CONN-003).
- **REQ-CONN-007** [client] The engine runs exactly while an identity exists. It starts after login or on startup with an identity (REQ-ID-001/003). It stops on logout (REQ-ID-004) and when the process ends. There is never more than one engine instance per process.

## Observable timing guarantees (used by scenarios)

These follow from the cycle above and are what the scenarios rely on:

| Event | Guaranteed effect, while the server is reachable |
|---|---|
| A user sends a message while `online` | Status reaches `sent` within 2 s |
| A message is stored for me while I'm `online` | It is displayed within 2 s (long-poll wake-up) |
| My portal flag goes `offline` | State becomes `offline` within 2 s (my in-flight long-poll is reset) |
| My portal flag goes `online` again | State becomes `online` within backoff cap + 2 s = **10 s** |
