import { readFileSync } from 'node:fs'

const expectedNode = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim()
const { packageManager } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const expectedNpm = packageManager?.match(/^npm@(\d+\.\d+\.\d+)$/)?.[1]
const actualNpm = process.env.npm_config_user_agent?.match(/^npm\/([^ ]+)/)?.[1]

if (process.versions.node !== expectedNode) {
  console.error(`运行时不一致：需要 Node ${expectedNode}，当前 ${process.versions.node}。请按 frontend/.node-version 切换后重新执行。`)
  process.exit(1)
}

if (!expectedNpm || actualNpm !== expectedNpm) {
  console.error(`运行时不一致：需要 npm ${expectedNpm ?? '（packageManager 未声明精确版本）'}，当前 ${actualNpm ?? '未知'}。请使用 package.json 的 packageManager 版本，通过 npm run check:runtime 复核。`)
  process.exit(1)
}

console.log(`运行时检查通过：Node ${expectedNode}、npm ${expectedNpm}。`)
