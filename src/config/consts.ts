// SPDX-License-Identifier: Apache-2.0

export const repo = 'https://github.com/TinyTapeout/siliwiz';

/** Prefixes a public asset path with the deployment base path (e.g. "/siliwiz/" on GitHub Pages) */
export function withBase(path: string) {
  return ((import.meta.env.SERVER_BASE_URL as string | undefined) ?? '').replace(/\/$/, '') + path;
}
