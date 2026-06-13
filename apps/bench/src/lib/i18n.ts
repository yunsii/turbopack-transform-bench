import { i18n } from '@lingui/core'

// Minimal runtime so lingui-macro-transformed code has something to render against.
i18n.load('en', {})
i18n.activate('en')

export { i18n }
