# 40 — Connectivity and the sync engine

All network I/O happens in **one** sync engine per client. It is a single
sequential loop: no parallel requests, no separate send path. The precise
cycle below is what makes the two clients behave identically.

## Engine cycle (normative pseudocode)

```
engine run (while logged in):
  failures    := 0
  probe       := true                       # REQ-SYNC-001: first sync of a run is a probe
  hasMore     := false
  wakePending := false                      # REQ-CONN-009: wake() sets it (and ends an interruptible wait)
  loop:
    wakePending := false                    # each cycle consumes any pending wake
    # Phase A: flush (REQ-OUTBOX-*)
    while outbox not empty:
      r := POST head                        # timeout 10 s (REQ-CONN-006)
      c := classify(r)                      # REQ-CONN-008
      if c is failure: goto FAILED
      if c is acknowledgement: apply REQ-OUTBOX-002
      if c is rejection: apply REQ-OUTBOX-004 / REQ-OUTBOX-006
      markOnline(); failures := 0
    # Phase B: one sync request (REQ-SYNC-*)
    if wakePending: continue loop           # REQ-CONN-009: woken during Phase A, so start a new cycle
    w := (probe or hasMore) ? 0 : 25
    r := GET after=cursor wait=w            # timeout w + 10 s; may be aborted by wake
    if r was aborted by wake: continue loop # not a failure; state, probe and hasMore unchanged
    if classify(r) is failure: goto FAILED  # REQ-CONN-008
    merge r (REQ-SYNC-002/003/005); hasMore := r.hasMore; probe := false
    markOnline(); failures := 0
    continue loop
  FAILED:
    markOffline()
    probe := true                           # next sync after a failure is a probe
    if not wakePending:                     # REQ-CONN-009: a pending wake skips the sleep
      sleep BACKOFF[min(failures, 3)]       # interruptible by wake
    failures := failures + 1
    continue loop

BACKOFF = [1 s, 2 s, 4 s, 8 s]
```

## Requirements

- **REQ-CONN-001** [client] The connection state is `online` or `offline`. It is `offline` when the engine starts. `markOnline()` / `markOffline()` set it, and the UI reflects every change (REQ-UI-003). The state means only "did my most recent completed request get an expected answer from the server" (an acknowledgement, a rejection or a successful sync response, REQ-CONN-008). A request aborted by wake does not count. Platform connectivity APIs MUST NOT set it directly.
- **REQ-CONN-002** [client] Each cycle runs Phase A (flush the whole outbox) **before** Phase B (one sync request). After any successful request the engine continues immediately, with no delay.
  - Consequence (the reconnect contract): on reconnect a client delivers **all** of its queued messages first, then receives what it missed. That sync includes its own just-sent messages, which are upserted, not duplicated.
- **REQ-CONN-003** [client] A **failed request** is any request whose outcome REQ-CONN-008 classifies as a failure: a network error, connection reset, timeout, a 5xx, or any status or body that the table does not list as an acknowledgement, a rejection or a successful sync response. It sets the state to `offline` and sleeps `BACKOFF[min(failures, 3)]` before the next cycle. The schedule is therefore 1 s, 2 s, 4 s, 8 s, 8 s, …
- **REQ-CONN-004** [client] A request whose outcome is an acknowledgement or a rejection (POST), or a successful sync response (GET), as classified by REQ-CONN-008, sets the state to `online` and resets `failures` to 0. No other outcome does. In particular, a 4xx to a sync request and an unlisted status to a POST (for example 404 or 429) are failures (REQ-CONN-003) that set the state to `offline`, even though an HTTP response arrived.
- **REQ-CONN-005** [client] **Wake** interrupts the engine's current wait:
  - **During a backoff sleep:** the sleep ends immediately and a new cycle starts. `failures` is **not** reset.
  - **During a Phase B sync request** (a long-poll or a probe; any request issued in Phase B): the request is aborted client-side and a new cycle starts **immediately**. The engine MUST NOT wait for the aborted request to settle; some HTTP stacks settle aborted requests late or never. The abort is **not** a failure, so the state is unchanged, and a response that arrives after the abort is discarded.
  - **During Phase A** (or at any moment when no interruptible wait is running): the flush is not interrupted, and a message enqueued meanwhile is picked up by the running flush loop. The wake is latched (REQ-CONN-009), so it takes effect at the next point where the engine would wait.

  Wake sources: a persisted send (REQ-SEND-004), the platform reporting that the network became available, and the app returning to the foreground.
- **REQ-CONN-006** [client] Timeouts:
  - POST: 10 s total, measured from issuing the request until the response body has been read.
  - GET: `wait` + 10 s total, measured the same way.
  - Connect phase: if the platform's HTTP stack can bound connection establishment separately, the client MUST bound it to 10 s. If the stack cannot (each platform profile says which case applies), the total timeouts above are the only bound. No observable timing guarantee below depends on the separate connect bound.

  A timeout is a failure (REQ-CONN-003).
- **REQ-CONN-007** [client] The engine runs exactly while an identity exists. It starts after login or on startup with an identity (REQ-ID-001/003). It stops on logout (REQ-ID-004) and when the process ends. There is never more than one engine instance per process.
- **REQ-CONN-008** [client] **Response classification.** Every completed request (one not aborted by wake or stop) has exactly one outcome:

  | Request | Response | Outcome |
  |---|---|---|
  | POST | 200 or 201, and the body is a well-formed message whose `id` equals the head's `id` | **acknowledgement** (REQ-OUTBOX-002) |
  | POST | 400 or 409, with any body | **rejection** (REQ-OUTBOX-004, REQ-OUTBOX-006) |
  | GET | 200, and the body is a well-formed sync response | **successful sync response** (REQ-SYNC-002/003) |
  | POST or GET | Anything else: network error, connection reset, timeout, any 5xx, any other status (for example 202, 204, 3xx, 404, 408, 413, 429, or any 4xx to a GET), or a listed status whose body is not well-formed | **failure** (REQ-CONN-003, REQ-OUTBOX-003) |

  *Well-formed* means the body parses as JSON and has every field that the schema (`message.schema.json` or `sync-response.schema.json`) lists as `required`, with the schema's JSON type (string, integer, boolean, array, object). Each item of `messages` must be a well-formed message. Clients need not check patterns, formats or lengths, and they ignore unknown fields (REQ-PROTO-004). The status is the final status the platform HTTP stack reports. A failure never changes the message store, the outbox or the cursor.
- **REQ-CONN-009** [client] **Wake latching.** `wake()` sets a single pending-wake flag. Several wakes before the flag is consumed count as one. The engine clears the flag at the start of every cycle. A wake that arrives during an interruptible wait (backoff sleep, Phase B request) also ends that wait (REQ-CONN-005). In addition:
  - If the flag is set when Phase B is about to issue its sync request (the wake arrived during Phase A), the request is not issued and a new cycle starts.
  - If the flag is set when a backoff sleep is about to start, the sleep is skipped, and `failures` is still incremented.

  So a wake is never lost, and it never causes more than one extra cycle.

## Observable timing guarantees (used by scenarios)

These follow from the cycle above and are what the scenarios rely on:

| Event | Guaranteed effect, while the server is reachable |
|---|---|
| A user sends a message while `online` | Status reaches `sent` within 2 s |
| A message is stored for me while I'm `online` | It is displayed within 2 s (long-poll wake-up) |
| My portal flag goes `offline` | State becomes `offline` within 2 s (my in-flight long-poll is reset) |
| My portal flag goes `online` again | State becomes `online` within backoff cap + 2 s = **10 s** |
