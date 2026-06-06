import { Observable, Subject } from 'rxjs'
import stripAnsi from 'strip-ansi'
import { Injector } from '@angular/core'
import { LogService } from 'tabby-core'
import { BaseSession, UTF8SplitterMiddleware, InputProcessor } from 'tabby-terminal'
import { SSHSession } from './ssh'
import { SSHProfile } from '../api'
import * as russh from 'russh'


export class SSHShellSession extends BaseSession {
    shell?: russh.Channel
    get serviceMessage$ (): Observable<string> { return this.serviceMessage }
    private serviceMessage = new Subject<string>()
    private ssh: SSHSession|null
    private destroying = false

    constructor (
        injector: Injector,
        ssh: SSHSession,
        private profile: SSHProfile,
    ) {
        super(injector.get(LogService).create(`ssh-shell-${profile.options.host}-${profile.options.port}`))
        this.ssh = ssh
        this.setLoginScriptsOptions(this.profile.options)
        this.ssh.serviceMessage$.subscribe(m => this.serviceMessage.next(m))
        this.middleware.push(new UTF8SplitterMiddleware())
        this.middleware.push(new InputProcessor(profile.options.input))
    }

    async start (options: { columns: number, rows: number }): Promise<void> {
        if (!this.ssh) {
            throw new Error('SSH session not set')
        }

        this.ssh.ref()
        this.ssh.willDestroy$.subscribe(() => {
            this.destroy()
        })

        this.logger.debug('Opening shell')

        try {
            this.shell = await this.ssh.openShellChannel({
                x11: this.profile.options.x11,
                columns: options.columns,
                rows: options.rows,
            })
        } catch (err) {
            if (err.toString().includes('Unable to request X11')) {
                this.emitServiceMessage('    Make sure `xauth` is installed on the remote side')
            }
            throw new Error(`Remote rejected opening a shell channel: ${err}`)
        }

        this.open = true
        this.logger.debug('Shell open')

        this.loginScriptProcessor?.executeUnconditionalScripts()

        this.shell.data$.subscribe(data => {
            this.emitOutput(Buffer.from(data))
        })

        this.shell.eof$.subscribe(() => this.destroyFromChannelEvent('Shell session ended'))
        this.shell.closed$.subscribe(() => this.destroyFromChannelEvent('Shell channel closed'))
    }

    emitServiceMessage (msg: string): void {
        this.serviceMessage.next(msg)
        this.logger.info(stripAnsi(msg))
    }

    resize (columns: number, rows: number): void {
        console.log(`resizePTY columns: ${columns}, rows: ${rows}`)
        if (!this.shell || !this.open) {
            return
        }
        this.shell.resizePTY({
            columns,
            rows,
            pixHeight: 0,
            pixWidth: 0,
        }).catch(err => this.destroyFromChannelEvent('Shell resize failed', err))
    }

    write (data: Buffer): void {
        if (!this.shell || !this.open) {
            return
        }
        this.shell.write(new Uint8Array(data)).catch(err => this.destroyFromChannelEvent('Shell write failed', err))
    }

    kill (_signal?: string): void {
        // this.shell?.signal(signal ?? 'TERM')
    }

    async destroy (): Promise<void> {
        if (this.destroying) {
            return
        }
        this.destroying = true
        this.logger.debug('Closing shell')
        this.serviceMessage.complete()
        this.kill()
        this.ssh?.unref()
        this.ssh = null
        await super.destroy()
    }

    private destroyFromChannelEvent (message: string, error?: unknown): void {
        if (error) {
            this.logger.error(`${message}: ${this.formatError(error)}`)
        } else {
            this.logger.info(message)
        }
        if (this.open && !this.destroying) {
            this.destroy().catch(err => this.logger.error(`Could not destroy SSH shell session: ${err}`))
        }
    }

    private formatError (error: unknown): string {
        if (error instanceof Error) {
            return error.message
        }
        if (error === null) {
            return 'null'
        }
        if (typeof error === 'object') {
            try {
                return JSON.stringify(error)
            } catch {
                return Object.prototype.toString.call(error)
            }
        }
        return String(error)
    }

    async getChildProcesses (): Promise<any[]> {
        return []
    }

    async gracefullyKillProcess (): Promise<void> {
        this.kill('TERM')
    }

    supportsWorkingDirectory (): boolean {
        return !!this.reportedCWD
    }

    async getWorkingDirectory (): Promise<string|null> {
        return this.reportedCWD ?? null
    }
}
