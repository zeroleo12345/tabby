import { Injectable, Injector } from '@angular/core'
import { AppService, LogService, Logger, ConfigService } from 'tabby-core'
import { createConditionalLogger, ConditionalLogger } from '../logHelper'
import { BaseSession, BaseTerminalTabComponent, SessionMiddleware } from 'tabby-terminal'
import { Subject, Subscription } from 'rxjs'
import { TmuxController } from '../session'

import { TmuxSessionTabComponent } from '../components/tmuxSessionTab.component'

/**
 * Middleware inserted at position 0 of the original session's middleware chain
 * while waiting for tmux control mode. It passes normal shell output through,
 * then captures raw tmux output for the gateway and BLOCKS it from propagating
 * further, so that other middleware plugins (e.g. trzsz) on the original
 * session do not see tmux control mode data.
 *
 * Without this interceptor, trzsz middleware on the original session would
 * detect trzsz protocol markers embedded in %output lines and trigger
 * chooseSendFiles() a second time ("double file dialog" bug).
 */
class TmuxOutputInterceptor extends SessionMiddleware {
    private _rawOutput = new Subject<Buffer>()
    private _controlModeDetected = new Subject<Buffer>()
    private active = false
    private pendingOutput = Buffer.alloc(0)
    /** Raw session output, before any middleware processing */
    rawOutput$ = this._rawOutput.asObservable()
    /** First tmux control mode output chunk, emitted when passthrough switches to interception */
    controlModeDetected$ = this._controlModeDetected.asObservable()

    feedFromSession (data: Buffer): void {
        if (!this.active) {
            const combined = Buffer.concat([this.pendingOutput, data])
            const controlModeStart = this.findControlModeStart(combined)

            if (controlModeStart !== -1) {
                if (controlModeStart > 0) {
                    super.feedFromSession(combined.subarray(0, controlModeStart))
                }

                this.pendingOutput = Buffer.alloc(0)
                this.active = true
                this._controlModeDetected.next(combined.subarray(controlModeStart))
                return
            }

            const passthroughLength = this.getSafePassthroughLength(combined)
            if (passthroughLength > 0) {
                super.feedFromSession(combined.subarray(0, passthroughLength))
                this.pendingOutput = combined.subarray(passthroughLength)
            } else {
                this.pendingOutput = combined
            }
            return
        }

        // Capture raw data for the tmux gateway
        this._rawOutput.next(data)
        // Do NOT call super.feedFromSession() — this blocks data from
        // propagating to the rest of the middleware chain (trzsz, etc.)
    }

    flushPendingOutput (): void {
        if (this.pendingOutput.length > 0) {
            super.feedFromSession(this.pendingOutput)
            this.pendingOutput = Buffer.alloc(0)
        }
    }

    private findControlModeStart (data: Buffer): number {
        const text = data.toString('utf-8')
        // console.log('text:', text)

        const dcsMatch = /(?:\x1bP\d+p|P\d+p)%(?:begin|end|error|exit|output|extended-output|layout-change|window-add|window-close|unlinked-window-close|window-renamed|unlinked-window-renamed|session-changed|sessions-changed|session-window-changed|window-pane-changed|pane-close|unlinked-pane-close|pause|continue|no-output)\b/.exec(text)
        if (dcsMatch) {
            return Buffer.byteLength(text.substring(0, dcsMatch.index), 'utf-8')
        }

        const plainMatch = /(^|[\r\n])%(?:begin|end|error|exit|output|extended-output|layout-change|window-add|window-close|unlinked-window-close|window-renamed|unlinked-window-renamed|session-changed|sessions-changed|session-window-changed|window-pane-changed|pane-close|unlinked-pane-close|pause|continue|no-output)\b/.exec(text)
        if (plainMatch) {
            const controlLineCharIndex = plainMatch.index + plainMatch[1].length
            return Buffer.byteLength(text.substring(0, controlLineCharIndex), 'utf-8')
        }

        return -1
    }

    private getSafePassthroughLength (data: Buffer): number {
        return data.length - this.getPotentialControlModePrefixLength(data)
    }

    /**
     * Keep only a tiny suffix that could become a tmux control mode marker when
     * the next output chunk arrives. Holding arbitrary bytes here delays normal
     * shell prompts because prompts usually do not end with a newline.
     */
    private getPotentialControlModePrefixLength (data: Buffer): number {
        const maxPrefixBytes = Math.min(data.length, 64)
        for (let start = data.length - 1; start >= data.length - maxPrefixBytes; start--) {
            const suffix = data.subarray(start).toString('utf-8')
            const atLineStart = start === 0 || data[start - 1] === 0x0a || data[start - 1] === 0x0d
            if (this.isPotentialControlModePrefix(suffix, atLineStart)) {
                return data.length - start
            }
        }
        return 0
    }

    private isPotentialControlModePrefix (text: string, atLineStart: boolean): boolean {
        const commands = [
            'begin',
            'end',
            'error',
            'exit',
            'output',
            'extended-output',
            'layout-change',
            'window-add',
            'window-close',
            'unlinked-window-close',
            'window-renamed',
            'unlinked-window-renamed',
            'session-changed',
            'sessions-changed',
            'session-window-changed',
            'window-pane-changed',
            'pane-close',
            'unlinked-pane-close',
            'pause',
            'continue',
            'no-output',
        ]

        if (text === '\x1b' || /^\x1bP\d*$/.test(text) || /^\x1bP\d+p%?$/.test(text)) {
            return true
        }

        const dcsMatch = /^\x1bP\d+p%(.*)$/.exec(text)
        if (dcsMatch) {
            return commands.some(command => command.startsWith(dcsMatch[1]))
        }

        const plainText = text[0] === '\r' || text[0] === '\n' ? text.slice(1) : text
        if ((atLineStart || text[0] === '\r' || text[0] === '\n') && plainText.startsWith('%')) {
            return commands.some(command => command.startsWith(plainText.slice(1)))
        }

        return false
    }

    // feedFromTerminal is NOT overridden — terminal→session data flows
    // through normally so the session can still receive input.
}

/** @hidden */
export { TmuxOutputInterceptor }

/**
 * TmuxService manages tmux integration.
 *
 * Each tmux session is bound to a terminal tab. When entering tmux mode,
 * the entire topmost Tab (usually a SplitTab) containing the terminal tab
 * is temporarily hidden from the Tabby tab list, and replaced with a
 * TmuxSessionTab at the top level. On disconnect, the original topmost Tab is restored.
 */
export interface SessionContext {
    controller: TmuxController
    active?: boolean
    disconnecting?: boolean
    /** The original terminal tab, hidden while tmux is active */
    terminalTab: BaseTerminalTabComponent<any>
    /** The concrete terminal session where the interceptor was installed */
    session: BaseSession
    /** The topmost parent Tab (SplitTabComponent or terminal tab) that was hidden */
    topmostTab?: any
    /** Original index of topmostTab in app.tabs, for restoring position */
    topmostTabIndex?: number
    sessionTabs: Map<number, TmuxSessionTabComponent>
    subscriptions: Subscription[]
    /** Interceptor middleware on the original session, removed on disconnect */
    outputInterceptor?: TmuxOutputInterceptor
}

interface DisconnectOptions {
    /**
     * Send a tmux control-mode detach command before tearing down the UI.
     * Should be false when tmux has already sent %exit, because the client may
     * have returned to the shell and would receive "detach" as a user command.
     */
    detach?: boolean
    /** Reinstall the passive control-mode listener after restoring the shell tab. */
    rearm?: boolean
}

@Injectable({ providedIn: 'root' })
export class TmuxService {
    private logger: Logger
    private sessions = new Set<SessionContext>()

    constructor (
        private injector: Injector,
        private appService: AppService,
        private configService: ConfigService,
        log: LogService,
    ) {
        this.logger = log.create('tmux-service')
    }

    private get log (): ConditionalLogger {
        return createConditionalLogger(this.logger, this.configService)
    }

    get isConnected (): boolean {
        return [...this.sessions].some(x => x.active)
    }

    get controller (): TmuxController | null {
        return [...this.sessions].find(x => x.active)?.controller || null
    }

    /** Find the SessionContext that owns a given tmux window tab. */
    findContextForTab (tab: TmuxSessionTabComponent): SessionContext | undefined {
        for (const ctx of this.sessions) {
            for (const sessionTab of ctx.sessionTabs.values()) {
                if (sessionTab === tab) {
                    return ctx
                }
            }
        }
        return undefined
    }

    private setupControllerEvents (context: SessionContext): void {
        context.subscriptions.push(context.controller.events.subscribe(event => {
            if (event.type === 'initialized' || event.type === 'session-changed') {
                this.ensureWindowTabs(context)
            } else if (event.type === 'window-add' && event.windowId !== undefined) {
                this.ensureWindowTab(context, event.windowId)
            } else if (event.type === 'window-close' && event.windowId !== undefined) {
                this.removeWindowTab(context, event.windowId)
            } else if (event.type === 'window-renamed' && event.windowId !== undefined) {
                this.updateWindowTabTitle(context, event.windowId)
            } else if (event.type === 'active-window-changed' && event.windowId !== undefined) {
                const tab = context.sessionTabs.get(event.windowId)
                const app = this.appService as any
                if (tab && app.activeTab !== tab) {
                    app.selectTab(tab)
                }
            }
        }))
    }

    private prepareOriginalTabReplacement (context: SessionContext): void {
        if (context.topmostTab) {
            return
        }
        // Find the topmost parent tab (the actual tab listed in the top tab bar)
        const topmostTab = context.terminalTab.topmostParent ?? context.terminalTab
        context.topmostTab = topmostTab

        // Remember the original index so we can replace in-place
        const tabs: any[] = (this.appService as any).tabs
        const index = tabs.indexOf(topmostTab)
        context.topmostTabIndex = index
    }

    private ensureWindowTabs (context: SessionContext): void {
        this.prepareOriginalTabReplacement(context)

        for (const windowState of context.controller.getAllWindowStates()) {
            this.ensureWindowTab(context, windowState.id)
        }

        const activeWindowId = context.controller.getActiveWindowId()
        const activeTab = activeWindowId !== null ? context.sessionTabs.get(activeWindowId) : undefined
        if (activeTab) {
            const app = this.appService as any
            app.selectTab(activeTab)
        }
    }

    private ensureWindowTab (context: SessionContext, windowId: number): void {
        if (context.sessionTabs.has(windowId)) {
            return
        }

        this.prepareOriginalTabReplacement(context)
        this.log.info(`Creating TmuxSessionTab for window @${windowId}...`)
        const app = this.appService as any
        const previousActiveTab = app.activeTab
        const isFirstWindowTab = context.sessionTabs.size === 0

        // IMPORTANT: We must use openNewTabRaw, NOT openNewTab.
        // openNewTab wraps non-SplitTab types in a wrapper SplitTab via wrapAndAddTab().
        // But TmuxSessionTabComponent extends SplitTabComponent, and wrapAndAddTab's
        // SplitTab.addTab(thing) has special logic: when thing instanceof SplitTabComponent,
        // it extracts thing.root and then DESTROYS thing. This kills our component instance
        // before it ever gets rendered, so ngOnInit/ngAfterViewInit never fire.
        //
        // openNewTabRaw adds the tab directly without wrapping, so our component's
        // view is properly attached and lifecycle hooks execute normally.
        const sessionTab = app.openNewTabRaw({
            type: TmuxSessionTabComponent as any,
            inputs: {
                existingController: context.controller,
                windowId,
                profile: {
                    sessionName: context.controller.getSessionName(),
                    terminalColorScheme: context.terminalTab.profile.terminalColorScheme,
                },
            },
        }) as TmuxSessionTabComponent

        context.sessionTabs.set(windowId, sessionTab)

        // Move the first tmux window tab to the same position as the original tab.
        // Later tmux window tabs are inserted immediately to the right of the
        // tab that was active when the new tmux window was created.
        const tabs: any[] = app.tabs
        const index = context.topmostTabIndex ?? -1
        if (isFirstWindowTab && index !== -1) {
            const sessionIndex = tabs.indexOf(sessionTab)
            if (sessionIndex !== -1) {
                tabs.splice(sessionIndex, 1)       // remove from end
                tabs.splice(index, 0, sessionTab)  // insert at original position
                app.tabsChanged.next()
            }
        } else {
            const previousIndex = tabs.indexOf(previousActiveTab)
            const sessionIndex = tabs.indexOf(sessionTab)
            if (previousIndex !== -1 && sessionIndex !== -1 && sessionIndex !== previousIndex + 1) {
                tabs.splice(sessionIndex, 1)
                const targetIndex = tabs.indexOf(previousActiveTab) + 1
                tabs.splice(targetIndex, 0, sessionTab)
                app.tabsChanged.next()
            }
        }

        // Hide the original topmost tab
        const topmostTab = context.topmostTab
        if (index !== -1) {
            const origIndex = tabs.indexOf(topmostTab)
            if (origIndex !== -1) {
                tabs.splice(origIndex, 1)
                ;(this.appService as any).tabsChanged.next()
            }
        }

        // When the session tab is closed (by user or disconnect), clean up
        context.subscriptions.push(sessionTab.destroyed$.subscribe(() => {
            if (context.sessionTabs.get(windowId) === sessionTab) {
                context.sessionTabs.delete(windowId)
                if (!sessionTab.closedByTmux && !context.disconnecting && context.active) {
                    context.controller.killWindow(windowId).catch(() => { /* window may already be gone */ })
                }
            }
        }))
    }

    private removeWindowTab (context: SessionContext, windowId: number): void {
        const tab = context.sessionTabs.get(windowId)
        if (!tab) {
            return
        }
        context.sessionTabs.delete(windowId)
        tab.closedByTmux = true
        tab.destroy()
    }

    private updateWindowTabTitle (context: SessionContext, windowId: number): void {
        const tab = context.sessionTabs.get(windowId)
        const windowState = context.controller.getWindowState(windowId)
        if (tab && windowState) {
            // tab.setTitle(windowState.name)
        }
    }

    async disconnectContext (context: SessionContext, options: DisconnectOptions = {}): Promise<void> {
        const detach = options.detach ?? true
        const rearm = options.rearm ?? false

        this.sessions.delete(context)
        context.disconnecting = true

        context.subscriptions.forEach(s => s.unsubscribe())

        if (context.active && detach) {
            // Detach from tmux control mode so the tmux client process exits
            // cleanly. Without this, the original terminal tab's PTY still has
            // a running `tmux -CC attach` process, causing "tmux is still running"
            // confirmation dialogs when the user tries to close the restored tab.
            context.controller.gateway.detach()
        } else {
            context.outputInterceptor?.flushPendingOutput()
        }

        // Remove the output interceptor from the original session's middleware chain
        if (context.outputInterceptor) {
            context.session.middleware.remove(context.outputInterceptor)
            context.outputInterceptor = undefined
        }

        if (context.active) {
            await context.controller.destroy()
        }

        // Destroy tmux window tabs (removes from tab bar)
        for (const sessionTab of context.sessionTabs.values()) {
            sessionTab.destroy()
        }
        context.sessionTabs.clear()

        // Restore the original topmost tab to the tab bar at its original position
        if (context.topmostTab) {
            const tabs: any[] = (this.appService as any).tabs
            const insertAt = context.topmostTabIndex !== undefined
                ? Math.min(context.topmostTabIndex, tabs.length)
                : tabs.length
            tabs.splice(insertAt, 0, context.topmostTab)
            const app = this.appService as any
            app.tabsChanged.next()

            // Activate the restored tab
            app.selectTab(context.topmostTab)
        }

        this.log.info('Disconnected tmux context')

        if (rearm && context.terminalTab.session === context.session && context.session.open) {
            await this.attachToTerminal(context.terminalTab)
        }
    }

    /**
     * Disconnect from all active tmux sessions.
     */
    async disconnect (): Promise<void> {
        for (const context of [...this.sessions].filter(x => x.active)) {
            await this.disconnectContext(context)
        }
    }

    /**
     * Watch an existing terminal tab for tmux control mode.
     * The terminal is replaced with a TmuxSessionTab only after tmux emits its
     * first control mode message. On disconnect, the terminal tab is restored.
     */
    async attachToTerminal (terminalTab: BaseTerminalTabComponent<any>): Promise<void> {
        const session = terminalTab.session
        if (!session) {
            this.logger.error('Terminal tab has no session')
            return
        }

        const existingContext = [...this.sessions].find(x => x.terminalTab === terminalTab)
        if (existingContext) {
            if (existingContext.session === session) {
                this.log.info('Tmux listener already attached to this terminal session')
                return
            }
            await this.disconnectContext(existingContext)
        }

        this.log.info('Waiting for tmux control mode on existing terminal session')

        const context: SessionContext = {
            controller: null!, // Set below
            active: false,
            terminalTab,
            session,
            sessionTabs: new Map(),
            subscriptions: [],
        }

        // Insert a tmux output interceptor at position 0 of the session's
        // middleware chain.  This captures raw output for the gateway and
        // prevents trzsz (or other) middleware on the original session from
        // seeing tmux control mode data (which would cause false positives).
        const interceptor = new TmuxOutputInterceptor()
        session.middleware.unshift(interceptor)
        context.outputInterceptor = interceptor

        this.sessions.add(context)

        context.subscriptions.push(interceptor.controlModeDetected$.subscribe((initialData: Buffer) => {
            if (context.active) {
                return
            }

            this.log.info('Detected tmux control mode output, activating tmux UI')
            context.active = true

            // Create a controller that uses the terminal's session for I/O
            context.controller = new TmuxController(
                this.logger,
                this.injector,
                (payload: string) => session.write(Buffer.from(payload)),
                () => this.disconnectContext(context, { detach: false, rearm: true }),
                this.configService,
            )

            // Subscribe to the interceptor's raw output to parse tmux control mode.
            // Feed raw buffers directly — the gateway handles line buffering internally
            // via executeData(), which properly handles TCP fragment boundaries.
            context.subscriptions.push(interceptor.rawOutput$.subscribe((chunk: Buffer) => {
                context.controller.handleData(chunk)
            }))

            this.setupControllerEvents(context)
            context.controller.handleData(initialData)
        }))

        // Handle terminal tab closure (disconnect on close)
        context.subscriptions.push(terminalTab.destroyed$.subscribe(() => {
            this.log.info('Attached terminal tab closed, disconnecting session')
            this.disconnectContext(context)
        }))

        context.subscriptions.push(session.destroyed$.subscribe(() => {
            this.log.info('Attached terminal session destroyed, disconnecting tmux listener')
            this.disconnectContext(context)
        }))
    }

    // replaceTabWithTmuxWindow removed as we open new tabs for windows instead
}
