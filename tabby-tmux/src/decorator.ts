import { Injectable } from '@angular/core'
import { BaseTerminalTabComponent, TerminalDecorator } from 'tabby-terminal'
import { TmuxService } from './services/tmux.service'
import { TmuxPaneSession } from './session'

/**
 * Watches native terminal sessions for tmux control mode.
 *
 * This lets users run `tmux -CC attach ...` directly in any terminal tab without
 * first using the context menu. Tmux pane sessions are skipped because they are
 * virtual sessions already driven by a TmuxController.
 */
@Injectable()
export class TmuxDecorator extends TerminalDecorator {
    constructor (
        private tmuxService: TmuxService,
    ) {
        super()
    }

    attach (terminal: BaseTerminalTabComponent<any>): void {
        setTimeout(() => {
            this.attachToSession(terminal)
            this.subscribeUntilDetached(terminal, terminal.sessionChanged$.subscribe(() => {
                this.attachToSession(terminal)
            }))
        })
    }

    private attachToSession (terminal: BaseTerminalTabComponent<any>): void {
        if (!terminal.session || terminal.session instanceof TmuxPaneSession) {
            return
        }
        this.tmuxService.attachToTerminal(terminal).catch(() => { /* logged by service */ })
    }
}
