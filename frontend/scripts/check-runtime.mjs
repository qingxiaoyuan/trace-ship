import { readFileSync } from 'node:fs'

const { engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const actualNpm = process.env.npm_config_user_agent?.match(/^npm\/([^ ]+)/)?.[1] ?? '未知'

console.log(
  `运行时提示：当前 Node ${process.versions.node}、npm ${actualNpm}。` +
    `package.json engines（Node ${engines?.node ?? '未声明'}，npm ${engines?.npm ?? '未声明'}）仅作兼容性参考，不限制启动。`,
)
