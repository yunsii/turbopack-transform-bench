# turbopack-transform-bench

Isolates the **marginal Turbopack build-time cost of per-file transforms** that a
production Next.js app commonly runs on every source file, mirroring a representative
slice of such a `next.config.ts`:

| transform | mechanism | how it's measured here |
|---|---|---|
| `auto-import-x-loader` | `turbopack.rules` — Node-worker loader on every `*.{js,jsx,ts,tsx}` | A/B wallclock (impl A loader vs impl B explicit imports) |
| `@svgr/webpack` | `turbopack.rules` — Node-worker loader on every `*.svg` | A/B wallclock (impl A loader vs impl B precompiled `.tsx`) |
| `@lingui/swc-plugin` | `experimental.swcPlugins` — in-process Wasm, every file | **trace only** (held ON as a constant; read its span from the trace) |

The comparison is **"same functionality, two implementations"** — impl B produces a
functionally-equivalent app without the transform — so a delta is the mechanism's
cost, not the cost of doing the work at all.

## Versions (pinned to a real production app)

`next@16.2.6` · `react@18.2.0` · `@lingui/swc-plugin@6.3.0` · `@lingui/{core,react}@6.2.0`
· `@svgr/webpack@^6.3.1` · `auto-import-x-loader@0.0.4` · Node 22 · pnpm 10.15.0.

All from public npm — no private registry needed.

## Layout

```
apps/bench/
  next.config.ts        # variant-gated: BENCH_AUTOIMPORT / BENCH_SVGR / BENCH_LINGUI / BENCH_MINIFY
  src/lib/*             # local stubs the auto-import map points at (Link, api, cls/tw, i18n)
  src/pages/            # index (trivial) + gen.page.tsx (re-exports generated Aggregator)
  src/generated/        # gitignored — produced by gen-fixtures.mts
  scripts/gen-fixtures.mts  # emits N components that genuinely trigger each transform
  scripts/bench.mts         # matrix runner + strict protocol + optional trace
```

## Run

```bash
pnpm install

# one-off: generate fixtures for the current flags and build
BENCH_FILES=300 pnpm gen
pnpm build

# full benchmark (sweeps file counts, K rounds, writes .bench-logs/summary.md)
BENCH_SCALES=300,600,1200 BENCH_ROUNDS=3 pnpm bench

# add trace builds to attribute lingui (and confirm loader spans)
BENCH_SCALES=600 BENCH_ROUNDS=3 BENCH_TRACE=1 pnpm bench
```

### Knobs

- `BENCH_FILES` — components to generate (gen) / `BENCH_SCALES` — comma list of file counts (bench)
- `BENCH_ROUNDS` — rounds per variant (median reported)
- `BENCH_MINIFY` — `1` mirrors production (default)
- `BENCH_TRACE` — `1` to also emit `NEXT_TURBOPACK_TRACING` builds per variant
- `BENCH_AUTOIMPORT` / `BENCH_SVGR` / `BENCH_LINGUI` — flip an individual transform (read by both gen and build)

## Methodology

- **Baseline** = lingui ON, both loaders OFF (functional app via explicit imports +
  precompiled svg components). Each variant flips exactly ONE loader to impl A; lingui
  is constant so it cancels in the delta.
- **Metric** = Turbopack's `Compiled successfully in X` (the phase where transforms run),
  not full `next build` wall (which is dominated by fixed page-data / static-gen).
  `per-file = Δ / file count`; sweep scales to check linearity.
- **Strict protocol** (from hard-won lessons profiling a large Next app build):
  `rm -rf .next node_modules/.cache/jiti` before every build,
  abort if a stray `next build` holds `.next` (stale builds look identical), median of
  K rounds, `childProcesses` runtime (workerThreads crashes on Node 24 / warns on 22).

## Reading a trace (for lingui / loader spans)

```bash
npx next internal trace .bench-logs/trace-base-600   # lingui span, no loader noise
# open https://trace.nextjs.org/ → "Spans in order" → Bottom-up / self-duration
#   - @lingui/swc-plugin → swc transform spans
#   - loaders            → run_loaders spans (compare trace-ai / trace-svg)
```

⚠️ Published Next exposes only `overview`-level tracing; per-loader / per-plugin spans
may need the `turbopack` preset (a custom Next build). If the span granularity can't
resolve lingui, flip `BENCH_LINGUI` manually for a wallclock figure.

## Caveats

- **Synthetic graph.** This measures per-file transform cost cleanly, but a large real
  app's `next build` is dominated by its shared module graph (thousands of modules
  compiled once). These numbers are the transform's cost over a clean baseline, not a
  prediction of how much of a real app's next build they account for — cross-check on the
  real app with a trace.
