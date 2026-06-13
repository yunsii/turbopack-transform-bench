import path from 'node:path'

import type { NextConfig } from 'next'

/**
 * Variant-gated config. Each per-file transform under test is toggled by an env
 * flag so the bench runner can A/B "same functionality, two implementations":
 *
 *   BENCH_AUTOIMPORT = '1' -> auto-import-x-loader injects imports (impl A)
 *                      '0' -> no loader; fixtures carry explicit imports  (impl B)
 *   BENCH_SVGR       = '1' -> @svgr/webpack turns *.svg into components   (impl A)
 *                      '0' -> no svg rule; fixtures import precompiled .tsx (impl B)
 *   BENCH_LINGUI     = '1' -> @lingui/swc-plugin transforms macros (kept on as the
 *                             constant; toggled only to read its trace/wallclock delta)
 *   BENCH_MINIFY     = '1' -> turbopackMinify (mirror production)
 *
 * Everything else mirrors a representative production turbopack config slice.
 */

const on = (v: string | undefined, dflt: boolean) =>
  v === undefined ? dflt : v === '1' || v === 'true'

const AUTOIMPORT = on(process.env.BENCH_AUTOIMPORT, true)
const SVGR = on(process.env.BENCH_SVGR, true)
const LINGUI = on(process.env.BENCH_LINGUI, true)
const MINIFY = on(process.env.BENCH_MINIFY, true)

const rules: Record<string, unknown> = {}

if (AUTOIMPORT) {
  // auto-import-x-loader on every non-foreign source file.
  rules['*.{js,jsx,ts,tsx}'] = {
    condition: { not: 'foreign' },
    loaders: [
      {
        loader: 'auto-import-x-loader',
        options: {
          imports: [
            {
              react: [
                'useState',
                'useCallback',
                'useMemo',
                'useEffect',
                'useRef',
                'useContext',
                'useReducer',
                'useLayoutEffect',
                'useId',
                'memo',
                'lazy',
                'forwardRef',
              ],
            },
            {
              '@/lib/Link': [['default', 'Link']],
              '@/lib/api': ['api'],
              '@/lib/css': ['cls', 'tw'],
            },
            {
              'next/link': [['default', 'NextLink']],
            },
          ],
          dts: false,
          logLevel: 1,
        },
      },
    ],
  }
}

if (SVGR) {
  // @svgr/webpack on every non-foreign svg.
  rules['*.svg'] = {
    condition: { not: 'foreign' },
    loaders: [
      {
        loader: '@svgr/webpack',
        options: {
          ref: true,
          svgoConfig: {
            plugins: [
              'preset-default',
              { name: 'prefixIds', active: true },
              { name: 'removeDimensions', active: true },
              { name: 'removeViewBox', active: false },
            ],
          },
        },
      },
    ],
    as: '*.js',
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  pageExtensions: ['page.tsx', 'page.ts'],
  output: 'standalone',
  productionBrowserSourceMaps: false,
  turbopack: {
    // Pin the workspace root to the monorepo root (lockfile + node_modules live
    // there), so Next doesn't infer it from a stray parent lockfile.
    root: path.resolve(__dirname, '../..'),
    rules: rules as never,
  },
  experimental: {
    turbopackMinify: MINIFY,
    swcPlugins: LINGUI ? [['@lingui/swc-plugin', {}]] : [],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
}

export default nextConfig
