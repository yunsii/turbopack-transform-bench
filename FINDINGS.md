# Findings

> Environment: WSL2, Node 22.22.2, Next 16.2.6 (Turbopack), minify on, `childProcesses`.
> Metric: Turbopack `Compiled successfully in X` (the phase transforms run in), median of 3 rounds.
> Baseline = lingui ON, both loaders OFF (functional app via explicit imports + precompiled svg).

## Wallclock A/B (the two Node-worker loaders)

| scale | baseline | auto-import Δ | ai ms/file | @svgr Δ | svg ms/file |
|---|---|---|---|---|---|
| 300 | 2.30s | +1.20s | 4.00 | +2.60s | 8.67 |
| 600 | 3.40s | +1.70s | 2.83 | +3.80s | 6.33 |
| 1200 | 6.10s | +2.80s | 2.33 | +7.60s | 6.33 |
| 2400 | 10.90s | +4.70s | 1.96 | +11.30s | 4.71 |
| 4800 | 20.00s | +9.10s | 1.90 | +22.00s | 4.58 |

## The shape: small fixed worker cost + linear marginal (converges)

Per-file cost *drops then stabilizes* — the early drop is a fixed Node-worker-pool / IPC
cost being amortized; once N is large the per-file marginal dominates and converges. So at
scale both loaders are essentially **linear** with a small offset:

| loader | fixed (worker pool + IPC) | marginal per file (converged) |
|---|---|---|
| `auto-import-x-loader` | ~0.3–0.7 s | **~1.9 ms** |
| `@svgr/webpack` | ~0.5–1.4 s | **~4.6 ms** (≈2.4× auto-import) |

Matches the deepwiki mechanism: JS loaders run in a Node worker pool (`childProcesses`), so
each build pays a fixed pool spin-up/bridge cost plus a steady per-file transform+IPC cost.

## ⚠️ Don't read the synthetic *fraction* as a real app's

At 4800 files svgr **doubles** compile (20s→42s) and auto-import adds 45% — but only because
these synthetic components are trivial (baseline ≈ 4.2 ms/file). The loader marginal is a
huge *fraction* of a near-empty baseline. A real large app is the opposite: its production
build typically spends on the order of tens to >100 ms per module (heavy import trees,
shared hubs), so the same ~1.9 / ~4.6 ms marginal is only a low-single-digit % per module.
The absolute ms/file is the transferable number; the % is not.

## @lingui/swc-plugin

Held ON as a constant (in-process Wasm; turbo_tasks caches the compiled module and per-file
results). Not A/B'd — read its cost from the trace:

```bash
npx next internal trace .bench-logs/trace-base-600   # lingui span, no loader noise
# https://trace.nextjs.org/ → Spans in order → Bottom-up / self-duration
```

## Caveats / how this maps to a real app build

- **Synthetic, small components.** Real-app modules are larger and import heavier trees, so
  the *marginal per-file* in a real app is likely higher than these figures.
- **Shared-graph dominance.** In a large real app the production next build is typically
  dominated by the shared module graph (thousands of modules compiled once). These loader
  costs sit *on top of* that graph cost. Extrapolating auto-import to a few thousand source
  files ≈ low-single-digit seconds — a real but minor slice; svgr scales with the (smaller)
  svg count.
- **Actionable read.** The fixed worker cost is unavoidable while the loader exists; moving
  svgr to a precompiled-`.tsx` codegen step removes both its fixed and marginal Turbopack
  cost and makes the output cacheable — worth it only if svgr's slice proves material on the
  real app (confirm with a trace on the real app).
