// Stand-in for cls / tw tagged-template className auto-import targets.
type TemplateFn = (strings: TemplateStringsArray, ...values: unknown[]) => string

const join: TemplateFn = (strings, ...values) =>
  strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ''), '').trim()

export const cls = join
export const tw = join
