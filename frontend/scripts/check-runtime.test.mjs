import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const runtimeScript = fileURLToPath(new URL('./check-runtime.mjs', import.meta.url))
const npmCli = process.env.npm_execpath
const npmVersion = process.env.npm_config_user_agent?.match(/^npm\/([^ ]+)/)?.[1]

async function checkRuntime(t, nodeVersion, packageManager) {
  assert.ok(npmCli && npmVersion, '请通过 npm run test:runtime 执行，以使用真实 npm CLI')
  const root = await mkdtemp(path.join(os.tmpdir(), 'trace-ship-runtime-'))
  t.after(() => {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root))
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
    assert.ok(path.basename(root).startsWith('trace-ship-runtime-'))
    return rm(root, { recursive: true, force: true })
  })
  const frontend = path.join(root, 'frontend')
  await mkdir(path.join(frontend, 'scripts'), { recursive: true })
  await writeFile(path.join(frontend, '.node-version'), `${nodeVersion}\n`)
  await writeFile(path.join(frontend, 'package.json'), JSON.stringify({
    type: 'module',
    packageManager,
    engines: { node: '0.0.0', npm: '0.0.0' },
    scripts: { 'check:runtime': 'node scripts/check-runtime.mjs' },
  }))
  if (existsSync(runtimeScript)) {
    await copyFile(runtimeScript, path.join(frontend, 'scripts/check-runtime.mjs'))
  }
  return spawnSync(process.execPath, [npmCli, 'run', 'check:runtime'], {
    cwd: frontend,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
  })
}

test('Node 和 npm 与精确版本 pin 不一致时仍允许继续', async (t) => {
  const result = await checkRuntime(t, '0.0.0', 'npm@0.0.0')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /仅作兼容性参考，不限制启动/)
})
