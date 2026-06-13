/**
 * Benchmark runner: isolates the marginal Turbopack build cost of each per-file
 * transform under test.
 *
 * Design — lingui is held ON as a constant (mirrors a typical app, where it's always on)
 * so it cancels out in the deltas; its own cost is read from the trace, not
 * A/B'd. The two Node-worker loaders are isolated: baseline uses impl B for them
 * (explicit imports + precompiled svg components), each variant flips exactly ONE
 * loader to impl A. The delta vs baseline is that loader's net cost:
 *
 *   base : AUTOIMPORT=0 SVGR=0 LINGUI=1   (loaders off; lingui on, constant)
 *   ai   : AUTOIMPORT=1 SVGR=0 LINGUI=1   (auto-import-x-loader, Node worker)
 *   svg  : AUTOIMPORT=0 SVGR=1 LINGUI=1   (@svgr/webpack, Node worker)
 *
 * @lingui/swc-plugin (in-process Wasm) is not toggled — set BENCH_TRACE=1 to read
 * its swc span from the Turbopack trace. (Flip BENCH_LINGUI manually if the trace
 * granularity can't resolve it and you want a wallclock figure.)
 *
 * Strict protocol (from hard-won lessons profiling a large Next app build):
 *   - rm -rf .next AND node_modules/.cache/jiti before EVERY build
 *   - assert no zombie `next` process holds .next (stale builds look identical)
 *   - K rounds, report median + min + spread; childProcesses (workerThreads crashes)
 *
 * Env:
 *   BENCH_SCALES=300,600   file counts to sweep (linearity check)
 *   BENCH_ROUNDS=3         rounds per variant
 *   BENCH_MINIFY=1         mirror production (passed through to next.config)
 *   BENCH_TRACE=0          if 1, one NEXT_TURBOPACK_TRACING build per variant at max scale
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..')
const LOG_DIR = path.join(APP_DIR, '.bench-logs')

const SCALES = (process.env.BENCH_SCALES ?? '300,600').split(',').map((s) => Number(s.trim()))
const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 3)
const MINIFY = process.env.BENCH_MINIFY ?? '1'
const TRACE = process.env.BENCH_TRACE === '1'

type Variant = { key: string; label: string; flags: Record<string, string> }
// lingui is ON in every variant (constant → cancels in deltas). Only the two
// Node-worker loaders are A/B'd. lingui's own cost comes from the trace.
const VARIANTS: Variant[] = [
  { key: 'base', label: 'baseline (loaders off)', flags: { BENCH_AUTOIMPORT: '0', BENCH_SVGR: '0', BENCH_LINGUI: '1' } },
  { key: 'ai', label: 'auto-import-x-loader', flags: { BENCH_AUTOIMPORT: '1', BENCH_SVGR: '0', BENCH_LINGUI: '1' } },
  { key: 'svg', label: '@svgr/webpack', flags: { BENCH_AUTOIMPORT: '0', BENCH_SVGR: '1', BENCH_LINGUI: '1' } },
]

const sh = (cmd: string, args: string[], env: Record<string, string>) =>
  spawnSync(cmd, args, {
    cwd: APP_DIR,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  })

function assertNoZombie() {
  const r = spawnSync('pgrep', ['-fa', 'next build'], { encoding: 'utf-8' })
  const lines = (r.stdout ?? '').split('\n').filter((l) => l && !l.includes('bench.mts'))
  if (lines.length) {
    console.error('[bench] ABORT: a `next build` process is already running (stale .next risk):')
    console.error(lines.join('\n'))
    process.exit(1)
  }
}

/** Parse Next's "✓ Compiled successfully in X" → seconds. Handles ms / s / min. */
function parseCompile(stdout: string): number | null {
  const m = stdout.match(/Compiled successfully in ([\d.]+)\s*(ms|min|s)/)
  if (!m) return null
  const n = Number(m[1])
  return m[2] === 'ms' ? n / 1000 : m[2] === 'min' ? n * 60 : n
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

type Row = { scale: number; variant: string; round: number; compile: number; wall: number }
const rows: Row[] = []

mkdirSync(LOG_DIR, { recursive: true })

for (const scale of SCALES) {
  for (const v of VARIANTS) {
    const env = { ...v.flags, BENCH_FILES: String(scale), BENCH_MINIFY: MINIFY }

    const gen = sh('pnpm', ['gen'], env)
    if (gen.status !== 0) {
      console.error(`[bench] gen failed for ${v.key}@${scale}:\n${gen.stderr ?? gen.stdout}`)
      process.exit(1)
    }

    for (let round = 1; round <= ROUNDS; round++) {
      assertNoZombie()
      sh('rm', ['-rf', '.next', 'node_modules/.cache/jiti'], {})

      const t0 = process.hrtime.bigint()
      const b = sh('pnpm', ['exec', 'next', 'build'], env)
      const wall = Number(process.hrtime.bigint() - t0) / 1e9

      if (b.status !== 0) {
        console.error(`[bench] build failed ${v.key}@${scale} round ${round}:`)
        console.error((b.stdout ?? '').split('\n').slice(-20).join('\n'))
        process.exit(1)
      }
      const compile = parseCompile(b.stdout ?? '')
      if (compile == null) {
        console.error(`[bench] could not parse compile time ${v.key}@${scale} round ${round}`)
        console.error((b.stdout ?? '').split('\n').slice(-20).join('\n'))
        process.exit(1)
      }
      rows.push({ scale, variant: v.key, round, compile, wall })
      console.log(`  ${v.key.padEnd(5)} @${scale} r${round}: compile ${compile.toFixed(2)}s  wall ${wall.toFixed(1)}s`)
    }
  }

  // Optional: one tracing build per variant at this scale. `base` (loaders off,
  // lingui on) gives the @lingui/swc-plugin span cleanly; ai/svg give the loader
  // spans (lingui span is constant noise there).
  if (TRACE) {
    for (const v of VARIANTS) {
      const traceFile = path.join(LOG_DIR, `trace-${v.key}-${scale}`)
      const env = { ...v.flags, BENCH_FILES: String(scale), BENCH_MINIFY: MINIFY, NEXT_TURBOPACK_TRACING: '1' }
      sh('pnpm', ['gen'], env)
      sh('rm', ['-rf', '.next', 'node_modules/.cache/jiti'], {})
      sh('pnpm', ['exec', 'next', 'build'], env)
      // This Next version ignores NEXT_TURBOPACK_TRACING_PATH and always writes
      // .next/trace-turbopack; copy it out before the next build wipes .next.
      const cp = sh('cp', [path.join(APP_DIR, '.next', 'trace-turbopack'), traceFile], {})
      console.log(
        cp.status === 0
          ? `  [trace] ${v.key}@${scale} -> ${traceFile}`
          : `  [trace] ${v.key}@${scale} FAILED to copy .next/trace-turbopack`,
      )
    }
  }
}

// ---- aggregate ----
const csv = ['scale,variant,round,compile_s,wall_s']
for (const r of rows) csv.push(`${r.scale},${r.variant},${r.round},${r.compile.toFixed(3)},${r.wall.toFixed(3)}`)
writeFileSync(path.join(LOG_DIR, 'results.csv'), csv.join('\n') + '\n')

const md: string[] = [
  '# Turbopack per-file transform — benchmark results',
  '',
  `Scales: ${SCALES.join(', ')} · rounds: ${ROUNDS} · minify: ${MINIFY} · Node ${process.version}`,
  '',
  'Compile time = Turbopack "Compiled successfully in" (the phase where transforms run).',
  'Δ vs baseline = that loader\'s marginal cost. per-file = Δ / file count.',
  '@lingui/swc-plugin is ON in every variant (constant) — read its cost from the trace,',
  'not this table (run with BENCH_TRACE=1).',
  '',
]

for (const scale of SCALES) {
  const compileMed = (key: string) =>
    median(rows.filter((r) => r.scale === scale && r.variant === key).map((r) => r.compile))
  const base = compileMed('base')
  md.push(`## ${scale} files`, '')
  md.push('| variant | median compile (s) | Δ vs base (s) | per-file (ms) |', '|---|---|---|---|')
  for (const v of VARIANTS) {
    const m = compileMed(v.key)
    const delta = v.key === 'base' ? 0 : m - base
    const perFile = v.key === 'base' ? 0 : (delta / scale) * 1000
    md.push(
      `| ${v.label} | ${m.toFixed(2)} | ${v.key === 'base' ? '—' : delta.toFixed(2)} | ${v.key === 'base' ? '—' : perFile.toFixed(3)} |`,
    )
  }
  md.push('')
}
writeFileSync(path.join(LOG_DIR, 'summary.md'), md.join('\n'))

console.log('\n' + md.join('\n'))
console.log(`\n[bench] wrote ${path.join(LOG_DIR, 'results.csv')} and summary.md`)
if (TRACE) {
  console.log('[bench] view a trace: npx next internal trace .bench-logs/trace-<variant>-<scale>  (then https://trace.nextjs.org/)')
}
