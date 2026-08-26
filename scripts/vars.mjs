import * as path from 'path'
import * as fs from 'fs'
import * as semver from 'semver'
import * as childProcess from 'child_process'

process.env.ARCH = ((process.env.ARCH || process.arch) === 'arm') ? 'armv7l' : (process.env.ARCH || process.arch)

import * as url from 'url'
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

const electronInfo = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../node_modules/electron/package.json')))

export let version = ""
try {
  version = childProcess.execSync('git describe --tags', { encoding:'utf-8' })
} catch {
  version = 'v0.0.1-34-gde1c5553'
}
version = version.substring(1).trim()
version = version.replace('-', '-c')

if (version.includes('-c')) {
    version = semver.inc(version, 'prepatch').replace('-0', `-nightly.${process.env.REV ?? 0}`)
}

export const builtinPlugins = [
    'tabby-core',
    'tabby-settings',
    'tabby-terminal',
    'tabby-web',
    'tabby-community-color-schemes',
    'tabby-ssh',
    'tabby-serial',
    'tabby-telnet',
    'tabby-local',
    'tabby-electron',
    'tabby-plugin-manager',
    'tabby-linkifier',
    'tabby-auto-sudo-password',
    'tabby-tmux',
]

export const packagesWithDocs = [
    ['.', 'tabby-core'],
    ['terminal', 'tabby-terminal'],
    ['local', 'tabby-local'],
    ['settings', 'tabby-settings'],
]

export const allPackages = [
    ...builtinPlugins,
    'web',
    'tabby-web-demo',
]

export const bundledModules = [
    '@angular',
    '@ng-bootstrap',
]
export const electronVersion = electronInfo.version

export const keygenConfig = {
    provider: 'keygen',
    account: 'da35e154-06ab-4367-b208-a773e3665891',
    channel: 'stable',
    product: {
        win32: {
            x64: '1f5da251-23c6-404f-b46b-1afcc315da3e',
        }[process.env.ARCH],
        darwin: {
            arm64: '4ea41b59-f2e2-4a73-a748-57d8a9aecc93',
        }[process.env.ARCH],
    }[process.platform],
}

if (!keygenConfig.product) {
    throw new Error(`Unrecognized platform ${process.platform}/${process.env.ARCH}`)
}
