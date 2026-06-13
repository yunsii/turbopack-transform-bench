import NextLink from 'next/link'
import type { ComponentProps } from 'react'

// Stand-in for an app's Link component auto-import target.
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink {...props} />
}
