// 极简 ESM loader：用 esbuild 转译 .ts，并重写 @/ 别名与无扩展名相对导入。
import { transform } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

const SRC = pathToFileURL(process.cwd() + '/src/').href

export async function resolve(specifier, context, nextResolve) {
  let candidate = null
  if (specifier.startsWith('@/')) {
    candidate = new URL(specifier.slice(2), SRC).href
  } else if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/.test(specifier)) {
    candidate = new URL(specifier, context.parentURL).href
  }
  if (candidate && !/\.[a-z]+$/.test(candidate)) {
    for (const ext of ['.ts', '.vue', '.json']) {
      if (existsSync(new URL(candidate + ext))) {
        specifier = candidate + ext
        break
      }
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const result = await nextLoad(url, { ...context, format: 'module' })
    const code = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString()
    const built = await transform(code, { loader: 'ts', format: 'esm', target: 'es2020' })
    return { format: 'module', source: built.code, shortCircuit: true }
  }
  return nextLoad(url, context)
}
