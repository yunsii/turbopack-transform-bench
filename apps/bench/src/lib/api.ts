// Stand-in for an app's api util auto-import target.
export const api = {
  get: async (path: string) => ({ path, ok: true }),
  post: async (path: string, body: unknown) => ({ path, body, ok: true }),
}
