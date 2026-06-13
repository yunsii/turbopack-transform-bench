// Variant-agnostic root page (no transform-triggering code) so a build always
// has a valid entry regardless of which transforms are toggled. All the
// per-file transform load lives in the generated fixtures behind /gen.
export default function Home() {
  return <div>turbopack-transform-bench — generated fixtures are at /gen</div>
}
