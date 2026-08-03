# L58 Quick Tunnel DNS Readiness Design

## Problem

The L58 remote-demo launcher currently treats the first valid
`trycloudflare.com` URL printed by `cloudflared` as a ready tunnel. A fresh
Quick Tunnel prints that URL before the connector is registered and before
the random hostname is published in public DNS.

On macOS, the launcher's first Node `fetch` can therefore query the hostname
while it still returns NXDOMAIN. The system resolver retains that negative
answer after public DNS has started returning Cloudflare edge addresses, so
every HTTP retry continues to fail with `ENOTFOUND` for the whole 90-second
readiness window.

The captured failing run established this ordering:

1. Quick Tunnel URL printed.
2. Node `fetch` immediately failed with `ENOTFOUND`.
3. `Registered tunnel connection` appeared about one second later.
4. Cloudflare DNS began returning A records about three seconds after the
   first failed request.
5. Direct DNS continued to resolve while Node `fetch` continued to receive
   the system resolver's negative result.

## Decision

Keep the short-lived Quick Tunnel architecture, but strengthen the tunnel
readiness contract. `startTunnel` may return only after all three conditions
are true:

1. `cloudflared` emitted exactly one validated HTTPS Quick Tunnel origin.
2. `cloudflared` emitted `Registered tunnel connection` for its connector.
3. A direct public DNS resolver returns at least one IPv4 address for that
   exact hostname.

The launcher must not call the system resolver or issue an HTTP request to the
fresh hostname before these conditions pass. This prevents the launcher from
creating the negative cache entry rather than trying to outwait it.

The DNS check remains inside the existing 30-second Quick Tunnel startup
budget. The existing 90-second public API readiness budget begins only after
the tunnel readiness contract passes and continues to enforce both
`/api/health` and `/api/public/runtime` with `payment_mode=mock`.

## Alternatives Considered

### Fixed delay after registration

Waiting a fixed 15 seconds matched one successful manual experiment, but it
does not observe the actual DNS condition and can fail again when publication
is slower. It is rejected.

### Cloudflare Named Tunnel

A Named Tunnel with a stable hostname removes fresh-hostname DNS publication
from every launch and is the preferred follow-up if the demo becomes a
repeated operational environment. It currently requires account, hostname,
and credential setup outside the bounded L58 Quick Tunnel scope, so it is not
the immediate repair.

## Components and Data Flow

`waitForQuickTunnel` owns the complete readiness state:

- accumulate the owned child's stdout/stderr safely enough to recognize
  output split across chunks;
- validate and retain the single Quick Tunnel URL;
- retain the connector-registration signal;
- once both signals exist, resolve only the validated hostname through the
  injected public resolver;
- retry transient DNS failures within the one existing timeout;
- resolve with `{ pid, url }` only after DNS returns a non-empty address list.

Production uses an explicit Cloudflare public resolver. Tests inject the DNS
operation so the ordering and retry behavior remain deterministic without an
external network.

## Failure and Cleanup Behavior

- Multiple Quick Tunnel URLs remain a hard failure.
- Child error or exit before readiness remains a hard failure.
- Missing registration or DNS publication before the 30-second deadline is a
  hard failure with a readiness-specific message.
- On any failure, the owned `cloudflared` child is terminated and the existing
  lifecycle rollback removes containers, network, temporary PostgreSQL data,
  state, and generated Mini Program files while retaining dependency caches.
- No fallback may weaken the `payment_mode=mock` check.

## Tests

The regression test must fail if production code returns on URL discovery
alone, resolves DNS before connector registration, or starts HTTP before the
DNS gate completes. It uses the real `waitForQuickTunnel` state machine with
an owned in-memory child stream and an injected DNS boundary.

Additional coverage verifies a transient DNS miss is retried within the same
deadline and that the existing multiple-URL, early-exit, strict API budget,
MOCK fail-closed, and rollback tests remain green.

## Scope

This repair changes only L58 tunnel readiness and its tests/documentation. It
does not add production deployment, real payment, persistent public exposure,
Cloudflare account credentials, or a general DNS subsystem.
