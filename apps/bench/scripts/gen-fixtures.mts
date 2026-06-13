/**
 * Fixture generator for the Turbopack per-file-transform benchmark.
 *
 * Generates N components that genuinely exercise each transform, in whichever
 * IMPLEMENTATION the env flags select — so the runner can compare "same
 * functionality, two implementations" (impl A = transform, impl B = none):
 *
 *   BENCH_AUTOIMPORT=1  components USE auto-import symbols without importing them
 *                       (auto-import-x-loader injects them)            [impl A]
 *   BENCH_AUTOIMPORT=0  same components carry explicit imports          [impl B]
 *
 *   BENCH_SVGR=1        each component imports its own *.svg (svgr loader) [impl A]
 *   BENCH_SVGR=0        each imports a precompiled .tsx svg component      [impl B]
 *
 *   BENCH_LINGUI=1      components carry a <Trans> macro (swc plugin)      [impl A]
 *   BENCH_LINGUI=0      same copy as plain JSX text, no macro             [impl B]
 *
 *   BENCH_FILES=<n>     how many components to generate (default 300)
 *
 * Output goes to src/generated/ (gitignored). Deterministic: no randomness.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GEN_DIR = path.resolve(__dirname, '../src/generated')

const flag = (v: string | undefined, dflt: boolean) =>
  v === undefined ? dflt : v === '1' || v === 'true'

const AUTOIMPORT = flag(process.env.BENCH_AUTOIMPORT, true)
const SVGR = flag(process.env.BENCH_SVGR, true)
const LINGUI = flag(process.env.BENCH_LINGUI, true)
const FILES = Number(process.env.BENCH_FILES ?? 300)

const svgBody = (i: number) => {
  const r = 6 + (i % 7) // vary so each svg is a distinct module, similar work
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="12" cy="12" r="${r}" />
  <path d="M12 6v6l4 2" />
</svg>
`
}

const precompiledIcon = (i: number) => {
  const r = 6 + (i % 7)
  return `import type { SVGProps } from 'react'

// Precompiled equivalent of what @svgr/webpack would emit for icon-${i}.svg
// (impl B: no build-time svg loader).
export default function SvgIcon${i}(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      {...props}
    >
      <circle cx={12} cy={12} r={${r}} />
      <path d="M12 6v6l4 2" />
    </svg>
  )
}
`
}

const component = (i: number) => {
  const explicitImports = AUTOIMPORT
    ? ''
    : `import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import Link from '@/lib/Link'
import { api } from '@/lib/api'
import { cls } from '@/lib/css'
`
  const linguiImport = LINGUI ? `import { Trans } from '@lingui/react/macro'\n` : ''
  const iconImport = SVGR
    ? `import Icon from './icon-${i}.svg'\n`
    : `import Icon from './Icon-${i}'\n`

  const label = LINGUI
    ? `        <Trans>
          Item ${i} clicked {count} times (x2 {doubled})
        </Trans>`
    : `        Item ${i} clicked {count} times (x2 {doubled})`

  // import ordering: third-party/macro, then svg (relative), then explicit stubs
  const header = [linguiImport, iconImport, explicitImports].filter(Boolean).join('\n')

  return `${header}
export function Comp${i}({ seed = ${i} }: { seed?: number }) {
  const [count, setCount] = useState(seed)
  const node = useRef<HTMLDivElement>(null)
  const doubled = useMemo(() => count * 2, [count])
  const tripled = useMemo(() => count * 3, [count])
  const bump = useCallback(() => {
    setCount((c) => c + 1)
    void api.get('/n/${i}')
  }, [])
  useEffect(() => {
    if (node.current) node.current.dataset.count = String(count)
  }, [count])
  const klass = cls\`comp comp-${i} \${count > 0 ? 'active' : 'idle'}\`
  return (
    <div ref={node} className={klass} data-id="${i}">
      <Icon aria-hidden />
      <Link href="/c/${i}">link ${i}</Link>
      <p>
        {doubled} / {tripled}
      </p>
      <button type="button" onClick={bump}>
${label}
      </button>
    </div>
  )
}
`
}

const aggregator = (n: number) => {
  const imports = Array.from({ length: n }, (_, i) => `import { Comp${i} } from './comp-${i}'`).join('\n')
  const renders = Array.from({ length: n }, (_, i) => `      <Comp${i} key={${i}} />`).join('\n')
  return `${imports}

export default function Aggregator() {
  return (
    <div>
${renders}
    </div>
  )
}
`
}

async function main() {
  await rm(GEN_DIR, { recursive: true, force: true })
  await mkdir(GEN_DIR, { recursive: true })

  const writes: Promise<void>[] = []
  for (let i = 0; i < FILES; i++) {
    writes.push(writeFile(path.join(GEN_DIR, `comp-${i}.tsx`), component(i)))
    if (SVGR) {
      writes.push(writeFile(path.join(GEN_DIR, `icon-${i}.svg`), svgBody(i)))
    } else {
      writes.push(writeFile(path.join(GEN_DIR, `Icon-${i}.tsx`), precompiledIcon(i)))
    }
  }
  writes.push(writeFile(path.join(GEN_DIR, 'Aggregator.tsx'), aggregator(FILES)))
  await Promise.all(writes)

  const variant = `AUTOIMPORT=${AUTOIMPORT ? 1 : 0} SVGR=${SVGR ? 1 : 0} LINGUI=${LINGUI ? 1 : 0}`
  console.log(`[gen] ${FILES} components | ${variant}`)
  console.log(`[gen] svg assets: ${SVGR ? `${FILES} *.svg (loader)` : `${FILES} *.tsx (precompiled)`}`)
  console.log(`[gen] -> ${GEN_DIR}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
