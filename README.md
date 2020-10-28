# `deno-glob-to-regexp`

Converts glob to regular expressions, taken straight from Deno standard library,
with one exception:

- Assumes that you are in a POSIX environment, if you are in Windows, you should
  normalize them to POSIX path separator first.

## Installation

- npm: `npm install @intrnl/deno-glob-to-regexp`
- pnpm: `pnpm install @intrnl/deno-glob-to-regexp`
- yarn: `yarn add @intrnl/deno-glob-to-regexp`
