# Browser runtime upgrade: engineering report

## Executive summary

Lens retains Playwright and Kujo's deterministic policy and evidence boundary.
The runtime now shares bounded readiness and lifecycle helpers, eliminates
recording-only work from ordinary flows, uses Playwright's native page recording,
and reuses a Chromium process inside crawl/watch sessions with fresh
contexts. Ordinary unconfigured checks remain one-shot. Cross-command daemon operation remains an experiment. Five-click flows are
89.3% faster, recorded five-click flows 70.6% faster, and ten-page crawls 46.2%
faster in the final eight-run Linux comparison. Fresh default browser-dependency
installation is 63.6% smaller. Small cold-check overheads are reported below.

## Architecture before

At baseline commit `e96fb383366b845c633302a59effd4b3010f4b6e` (Lens 1.0.1),
each provider call started Node, loaded Playwright, launched Chromium, captured
viewports in separate contexts, and closed the browser. Kujo's crawl repeated
that lifecycle per page. Watch repeated the pipeline. Flow clicks included
custom DOM cursor animation and fixed pauses even without recording. Recording
used context video, then searched and renamed generated files.

## Architecture after

Unconfigured single checks remain one-shot. The shell entrypoint owns a local
Node supervisor for crawl, watch and checks using a configuration file (which may
enable crawl). Kujo still owns
configuration, BFS queue order, URL policy, redaction, findings and reporting.
Within those sessions, each provider request goes over a private Unix socket to
one browser.
Each viewport gets a fresh context and page. Results keep input order under
bounded concurrency; one failed viewport does not erase successful captures.
An engine change or disconnected browser causes replacement for the next job;
no uncertain job or mutating flow is automatically replayed.

The supervisor exits with its child. During watch, an idle browser closes after
60 seconds and is recreated if needed. Every ordinary command ends its session;
there is no shared cross-command background service. Direct bridge invocation
remains one-shot. Flow and inspect share runtime helpers but use owned browsers.

Numeric monotonic phase durations and fixed readiness reasons are diagnostic
metadata only. They never affect PASS/FAIL, baseline pixels or finding order.
Crawl receipts count actual browser launches, contexts and captured pages.
The BFS frontier and safe-candidate discovery stop at the lifetime page budget,
avoiding normalization, copying and quadratic deduplication of hundreds of links
that the crawl could never visit. Kujo still applies every existing URL guard to
every queued candidate.

## Deleted complexity

- Custom cursor DOM injection, multi-frame mouse interpolation and ripple code.
- Unconditional post-click and scroll pauses in normal flows.
- Recording directory scanning, primary-file guessing, renaming and extra-file deletion.
- General `networkidle` readiness and its unconditional follow-up delay.
- Persistent plaintext flow program artifacts; private stdin carries execution programs.
- Queuing and deduplicating crawl entries beyond the page limit.
- Unused full-body text lowercasing and repeated `innerText` extraction.

## Performance

The acceptance comparison uses eight repetitions per case on one clean GitHub
Actions Ubuntu 24.04.4 x86_64 runner with Node 20.20.2. Both revisions use
the same Kujo 1.3.1 release binary and identical fixtures.
[The complete workflow passed](https://github.com/kujolang/lens/actions/runs/34084543631),
including functional verification before measurement. The candidate is
`e8cf9357462aa1ab438b5b358eee3c9d84d131dc`; its final production runtime change is
`45af1d798ffe19bc876750c2b36a2d1c5ec542f3`. CI's baseline
`504ff55a63440b895bd4ea515612ddde94ea9cdb` has identical production runtime and
fixture sources to the initial local baseline `e96fb38` (the intervening commits
add hardening evaluation documents/artifacts only).

Values are median seconds; positive improvement means lower latency. Every
check in this table starts a fresh Node/Chromium process except the pages within
a crawl. The independent loop is five separate ordinary CLI invocations.

| Benchmark | Before | After | Seconds saved | Improvement |
|---|---:|---:|---:|---:|
| Trivial check | 1.726 | 1.740 | -0.014 | -0.8% |
| Realistic check | 1.952 | 1.970 | -0.018 | -0.9% |
| Quick trivial | 1.265 | 1.288 | -0.024 | -1.9% |
| Quick realistic | 1.486 | 1.530 | -0.043 | -2.9% |
| SPA (quick) | 1.381 | 1.298 | +0.082 | +5.9% |
| Image-heavy (quick) | 1.430 | 1.440 | -0.011 | -0.7% |
| Many-links (quick) | 1.324 | 1.348 | -0.025 | -1.9% |
| Late-network (quick) | 2.079 | 1.862 | +0.217 | +10.4% |
| Inspect | 1.009 | 1.033 | -0.024 | -2.4% |
| 5-page crawl | 8.028 | 3.972 | +4.056 | +50.5% |
| 10-page crawl | 13.403 | 7.215 | +6.188 | +46.2% |
| 1-click flow | 3.433 | 1.118 | +2.315 | +67.4% |
| 5-click flow | 11.682 | 1.250 | +10.432 | +89.3% |
| Recorded 5-click flow | 14.681 | 4.309 | +10.372 | +70.6% |
| Navigation-heavy flow | 11.813 | 1.392 | +10.422 | +88.2% |
| Five independent checks | 6.210 | 6.335 | -0.125 | -2.0% |
| Direct bridge, trivial | 1.515 | 1.533 | -0.018 | -1.2% |
| Direct bridge, realistic | 1.751 | 1.766 | -0.016 | -0.9% |


### Measurement provenance and regression investigation

[Raw receipts](../benchmarks/runtime-upgrade/README.md) preserve the earlier
macOS trials, slower observations, paired diagnostics and the successful
three-run Linux confirmation. These are implementation-stage evidence, not
measurements of the final source revision.

An initial paired desktop image-heavy result showed a 131ms median regression.
Direct bridge profiling found a roughly 50ms readiness polling penalty. The
observer now waits until the minimum evidence horizon before asking the browser
for state. A Linux regression test then exposed early Node timer wakeups that
could still trigger an extra poll; the final implementation rechecks the
monotonic deadline after every timer wakeup. This establishes the cause and fix
for that polling penalty, not every millisecond of desktop variance.

Later desktop batches became unsuitable for acceptance: the enclosing Codex host
accumulated over 1,000 unreaped children, process creation failed, and startup
latencies shifted severalfold. Their root cause is unverified. Entire affected
batches, including successful samples, are retained with `excluded_reason`; the
comparison tool rejects them. The final clean-runner comparison above is
the acceptance evidence, not selected fast desktop samples.

### Measured cold-check tradeoff

The final cold CLI batch is 0.8–2.9% slower on simple/realistic checks (14–43ms),
while SPA and late-network fixtures improve. This is not reported as a speedup
or dismissed as noise. A [24-pair alternating phase run](https://github.com/kujolang/lens/actions/runs/34086825049)
confirmed small repeatable direct-bridge costs:

| Profiled fixture | Before, ms | After, ms | Median paired delta, ms | 95% bootstrap interval, ms |
|---|---:|---:|---:|---:|
| Trivial | 1050.5 | 1058.2 | +19.9 | +11.9 to +23.1 |
| Image-heavy | 1203.7 | 1223.6 | +22.2 | +16.3 to +27.2 |

Median paired differences need not equal the difference of batch medians.
The fixed-seed bootstrap is diagnostic and the API preload adds instrumentation;
these numbers do not replace the ordinary CLI table. The earlier eight-pair
profile showed a +97.3ms image delta from variable page creation/navigation;
that larger penalty did not reproduce across 24 pairs. Both receipts are kept.

In the 24-pair image profile, driver loading rose 5.6ms, readiness finished at
506ms versus the former 500.5ms network-idle wait, the observer installation
cost 2.4ms, and page evaluations rose 4.0ms. Some categories overlap; they must
not be added as independent wall-clock totals. PNG capture itself improved
from 41.2ms to 37.2ms. This localizes the small cost to the newer matched runtime
and added bounded observation, rather than a leftover recording sleep or a
repeated browser launch.

The strict zero-regression goal for cold checks is therefore not met. The
implementation retains this measured small overhead for explicit readiness,
structured diagnostics and lifecycle reliability. It does not shorten the
500ms late-evidence horizon to manufacture a lower benchmark. Independent
commands still pay startup; the owned-host loop is the measured reuse path.

### Owned-host prototype

These separate macOS 26.6.2 x86_64 trials use Node 26.7.0 and Kujo 1.2.3.
They evaluate the owned host design; they are not a cross-command daemon result.
Each cold trial starts a fresh Node process and Chromium; warm jobs use fresh
contexts in that process. Eight cold trials and 32 warm jobs were measured.

| Measurement | Median, seconds |
|---|---:|
| Five one-shot checks | 19.050 |
| Five checks sharing a host | 13.212 |
| Cold first check (including host boot) | 3.809 |
| Warm subsequent check | 2.326 |

Sharing the host saves 30.6% over this five-check loop. Every trial used one browser and ended with
zero open contexts. The retained process tree had four processes; median RSS
was 230.4 MiB. RSS sums can double-count shared
pages and are a comparative diagnostic, not a precise private-memory total.

The 30-second idle trial closed its browser after 30.063 seconds (observed from the direct IPC response).
The 60-second idle trial closed its browser after 60.063 seconds (observed from the direct IPC response).

Both idle settings released Chromium. Sixty seconds is the bounded watch
default; these synthetic trials establish cleanup behavior, not an optimal
human editing interval. Cross-command auto-start/discovery is not shipped.

### Concurrency and capture costs

Three macOS repetitions, eight viewports per capture, with one browser retained
across the diagnostic. All cases completed without cleanup failures or browser restarts.

| Fixture | Limit 1 | Limit 2 | Limit 4 | Limit 8 |
|---|---:|---:|---:|---:|
| trivial | 9.549 | 5.069 | 2.813 | 1.787 |
| spa | 9.566 | 5.044 | 2.821 | 1.737 |
| image-heavy | 10.873 | 5.952 | 3.643 | 2.554 |

The clean Linux runner also measured three repetitions at each limit:

| Fixture | Limit 1 | Limit 2 | Limit 4 | Limit 8 |
|---|---:|---:|---:|---:|
| trivial | 7.892 | 4.074 | 2.172 | 1.270 |
| spa | 7.852 | 4.066 | 2.185 | 1.253 |
| image-heavy | 8.958 | 4.656 | 3.423 | 2.515 |

The separate macOS image-heavy RSS diagnostic (three trials) peaked at a median 550.4 MiB with limit 4, and at most 8 processes.

The separate image-heavy RSS diagnostic (three trials) peaked at a median 830.2 MiB with limit 8, and at most 12 processes.

Four is a conservative default memory bound, not the fastest setting for eight
viewports on this machine. The default two-viewports check is unaffected; users
with sufficient memory can use the existing concurrency control. Linux CI also measures these limits; the memory tradeoff does not justify
raising the automatic cap for every machine.

Final Linux inspect phase medians separate startup and evidence work: Node
boot 19.6ms, Playwright loading 291.5ms, Chromium launch 94.4ms, readiness 505.9ms,
DOM capture 5.1ms and browser close 24.7ms. Combining more DOM traversals would save little
relative to startup and the evidence horizon. Native recording keeps readable
click annotations while ordinary flow clicks do no visual pacing.

The intermediate five-page crawl with browser reuse and queue capping alone
measured 25.75 s. Stopping safe-candidate normalization/copying at the same page
budget reduced the final median to 8.61 s; safety and BFS-prefix tests stayed
green. This avoids attributing all crawl gains to browser launch savings.

## Footprint

Sizes below are installed browser-dependency disk allocation (`du -sk`),
including the required Playwright FFmpeg bundle. Unchanged Kujo/Node runtimes,
optional system FFmpeg and unrelated cached engines are excluded. Totals describe
a fresh default installation, not in-place shrinking of an existing multi-engine
cache. Lens does not delete user-managed browser applications.

| Component | Before, KiB | After, KiB |
|---|---:|---:|
| npm dependencies | 15,420 | 15,632 |
| Chromium full browser | 377,560 | 0 |
| Chromium headless shell | 210,448 | 201,792 |
| FFmpeg | 3,340 | 3,340 |
| Total default installation | 606,768 | 220,764 |

The default footprint falls from 592.55 MiB to 215.59 MiB (63.6%). The npm
package grows by 212 KiB. Firefox and WebKit retain separate full-engine
installation instructions. PNG screenshot format and dimensions are unchanged.

## Reliability

Navigation still reaches `load`. A shared observer then checks DOM mutations
and completed/in-flight network requests for a 250 ms quiet window. The minimum
evidence horizon is 500 ms plus `settle_ms` (normally another 400 ms), preserving
late console/network evidence rather than equating a fast load with readiness.
The normal maximum is two seconds, constrained by the operation timeout; larger
explicit settle values extend that bound. Permanent requests and continuously
mutating pages produce `max-wait-reached` and usable evidence. A visible explicit
`ready_selector` takes precedence. Neither heuristic can predict arbitrarily
late future activity; applications needing that guarantee should provide a
readiness selector or an explicit flow wait/assertion.

Flow selector/text assertions wait for their declared state within the step
timeout, so removing click pauses does not require guessing an application delay.
Context/page creation, readiness installation, evaluation and recording finalization
have operation deadlines; context cleanup has a five-second ceiling. Stress
testing found an otherwise unbounded lifecycle wait, which now retires the
browser while retaining completed evidence.
Context cleanup runs in `finally`, and unexpected page errors join console
evidence. Recording teardown failure retains completed steps and removes the
incomplete video. Browser launch and
crash classifications remain distinct from page findings. Provider retries
remain narrow; mutating flows are not replayed. A failed cleanup retires a
session browser before another job can inherit it. Client disconnection cancels
its browser job, including late completion of an in-flight launch; shutdown
does not rearm idle timers.

## Security

The socket lives in an unpredictable mode-0700 directory, is mode 0600, and
has no TCP listener. It accepts serialized observation requests only. Request
and response buffers are bounded and errors use fixed messages. Contexts,
cookies, local storage, cache and service workers are not reused across jobs.
Explicit storage state remains the only intentional state injection.

Timing fields contain numbers and fixed category names, never URLs, selectors,
page text, auth state or credentials. Native action visualization is enabled
only around clicks with a fixed descriptive label; typing has no action title.
Secret inputs are visually masked before filling, and declared typed secrets
are scrubbed from returned structured strings. Kujo retains artifact redaction
and the existing MP4 fallback. Recording stays capped at 100 MiB.

Inspect excludes editable form values from selector/text evidence, including
prefilled password fields and textareas; button labels remain useful.

Programs travel through Kujo's private stdin support, which unlinks its private
spool before child launch. No `flow-program.json` is left in reports. Signal
shutdown closes browser, socket and child process group. An uncatchable SIGKILL
can leave an empty private socket directory; unique directories prevent stale
socket attachment and no job data is stored there. Watch checks supervisor
liveness before continuing. A same-user process already able to read Lens's
memory is outside this IPC isolation boundary.

## Compatibility

- Lens version: 1.1.0; baseline: 1.0.1.
- Exact Playwright 1.61.1 and axe-core 4.11.4 pins replace broad ranges.
- Node >=18 remains supported; `.nvmrc` stays on 20.
- Kujo >=1.2.3 is required for safe stdin process support.
- Default Chromium install uses `--only-shell`; Firefox/WebKit remain optional.
- Existing exit codes, screenshot names, walkthrough WebM/MP4 paths, JSON
  evidence schema and mutation gates remain. New metadata is additive.
- `ready_selector` / `--ready-selector` is optional; existing settle and explicit
  flow wait controls still work.

Playwright 1.63.0 was the registry's stable release during this pass, but its
browser download repeatedly failed in this environment. 1.61.1 supplies the
required production screencast cursor API without raising Node requirements.
It was validated against its matching Chromium revision rather than pairing a
new driver with an older browser. See [Playwright screencast API](https://playwright.dev/docs/api/class-screencast),
[browser installation](https://playwright.dev/docs/browsers), and
[release notes](https://playwright.dev/docs/release-notes).

## Fixed-wait and lifecycle audit

| Occurrence | Classification | Decision |
|---|---|---|
| Explicit flow `wait` | USER-REQUESTED | Retained, bounded to 10 seconds |
| Final recording frame, 300 ms | RECORDING-ONLY | Retained for usable final video frame |
| Native click annotation, 500 ms | RECORDING-ONLY | Visual duration; normal clicks have no annotation |
| Readiness horizon timer | REQUIRED | Observers run during the minimum evidence horizon; no premature browser queries |
| Readiness poll, 50 ms | REQUIRED | Bounded observation after the horizon, ends on state |
| Operation and IPC deadlines | REQUIRED | Failure bounds, timers cleared on completion |
| Context cleanup, at most 5 seconds | REQUIRED | Retires the browser on incomplete cleanup |
| Browser close | REQUIRED | Playwright close-or-kill lifecycle; supervisor shutdown also bounded |
| Browser idle, 60 seconds | REQUIRED | Releases memory during inactive watch |
| Forced shutdown, 3 seconds | REQUIRED | Bounds abnormal child termination |
| Watch interval | USER-REQUESTED | Existing interval control |
| Fixture/test delays | REQUIRED | Deliberately exercise delayed or never-idle pages |
| Benchmark/CI server startup sleep | REPLACEABLE-BY-CONDITION | Replaced with HTTP readiness probes |
| Cursor interpolation/ripple/post-action waits | LEGACY | Deleted |

Contexts remain the isolation boundary. Automatic viewport concurrency is now
four; explicit values are bounded at sixteen. There is no unbounded page fanout.
Accessibility injection remains opt-in. DOM and link evaluations remain separate
small bounded captures until measurements justify coupling their implementations.
Viewport PNG evidence is retained; no lossy visual-baseline optimization ships.

## Tests

Local verification completed with these exact counts (baseline: 448 Kujo tests
and 18 bridge tests):

| Suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Kujo 1.2.3 | 462 | 0 | 0 |
| Node 26.7.0 bridge, including real Chromium | 51 | 0 | 0 |
| Real Chromium CLI E2E | 10 | 0 | 0 |
| Benchmark failure/resume/exclusion harness | 3 | 0 | 0 |
| Node 18.20.8 bridge, including real Chromium | 51 | 0 | 0 |
| Node 20.20.2 unit compatibility | 28 | 0 | 7 browser groups |
| Node 22.23.2 unit compatibility | 28 | 0 | 7 browser groups |

Firefox and WebKit each passed a local CLI capture with their matching installed
engines. Every bridge entry/helper passed `node --check`; Python harnesses
compiled, and incomplete benchmark receipts were rejected. Desktop and mobile
trivial-fixture PNGs matched the baseline byte for byte. The final Linux performance job passed 462 Kujo tests, 51 real-browser bridge
tests, 10 CLI E2E cases and 3 benchmark-harness checks before measurement. The complete six-cell Linux/macOS compatibility matrix is configured
but is not claimed as executed by that dedicated job.

The CLI cases cover PNG visual baselines, HTML/JSON artifacts, accessibility,
performance evidence, ten-page single-launch crawl, deterministic BFS including
a failed branch and relative child links, inspect, recorded secret-input flows,
flow safety gates, URL redaction, watch context isolation and shutdown.
The native WebM was decoded and visually reviewed; the CLI suite also verifies
the optional H.264 MP4 when system FFmpeg is available.

## Remaining opportunities

### Recommended

Keep exact browser revision installation coupled to dependency upgrades. Re-run
the labeled benchmark on deployment hardware before changing concurrency defaults.
Re-evaluate newer Playwright releases when their matching browser download can
be validated; do not substitute a mismatched installed engine.

### Experimental

A cross-command host may reduce repeated development-loop startup further.
The prototype measures first/warm latency, process count, RSS, fresh-context
isolation and 30/60-second idle cleanup, but is not enabled as a daemon. Native
CDP/Rust remains future-provider R&D with a much larger compatibility burden.

### Not worth doing

Replacing Playwright with a browser agent framework, adding AI verdicts,
reusing dirty contexts, or changing deterministic PNG baselines to lossy images.
None addresses the measured bottlenecks while preserving Lens's contract.

## Final verdict

No absolute optimum has been established. The shipped runtime is substantially
faster for flows and crawl, smaller to install, and bounded in state lifetime
while retaining Playwright and cross-browser capability. Ordinary cold checks
retain small measured costs for shared readiness, diagnostics and the newer
matching engine; the report does not claim every benchmark became faster.

What remains is specific: one-shot checks still pay Node/driver/browser startup;
a cross-command host could avoid it but adds discovery and stale-state handling;
concurrency above four can be faster at a measured memory cost; and newer driver
releases need a successful matching-engine installation and the same validation.
These are explicit tradeoffs, not reasons to replace Playwright or introduce AI
into verification. The measured conservative defaults are ready for review, with the cold-check
tradeoff disclosed rather than a claim of universal speed improvement.
