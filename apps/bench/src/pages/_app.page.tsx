import { I18nProvider } from '@lingui/react'
import type { AppProps } from 'next/app'

import { i18n } from '@/lib/i18n'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <I18nProvider i18n={i18n}>
      <Component {...pageProps} />
    </I18nProvider>
  )
}
