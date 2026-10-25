import { Injectable } from '@angular/core'
import { TabContextMenuItemProvider, MenuItemOptions, BaseTabComponent } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import { TmuxService } from './services/tmux.service'
import { TmuxSessionTabComponent } from './components/tmuxSessionTab.component'
import { TmuxPaneTabComponent } from './components/tmuxPaneTab.component'

/**
 * TmuxContextMenuProvider - Adds tmux-related items to tab context menu.
 *
 * - On a terminal tab: "Enter Tmux Mode"
 * - On a TmuxSessionTab / TmuxPaneTab: "Exit Tmux Mode" + Split + Close pane
 */
@Injectable()
export class TmuxContextMenuProvider extends TabContextMenuItemProvider {
    weight = 5

    constructor (
        private tmuxService: TmuxService,
    ) {
        super()
    }

    async getItems (tab: BaseTabComponent, _tabHeader?: boolean): Promise<MenuItemOptions[]> {
        // On a TmuxSessionTab: show exit option
        if (tab instanceof TmuxSessionTabComponent) {
            return []
        }

        // On a TmuxPaneTab: show exit, split, and close pane
        if (tab instanceof TmuxPaneTabComponent) {
            return []
        }

        // On a terminal tab: show enter tmux mode option
        if (tab instanceof BaseTerminalTabComponent) {
            return []
        }

        return []
    }

    private async splitPane (paneTab: TmuxPaneTabComponent, direction: 'right' | 'down' | 'left' | 'up'): Promise<void> {
        const controller = paneTab.controller
        if (!controller) return

        const paneId = paneTab.paneId
        const flagMap: Record<string, string> = {
            right: '-h',
            down: '-v',
            left: '-h -b',
            up: '-v -b',
        }
        const flag = flagMap[direction]
        await controller.gateway.sendCommand(`split-window ${flag} -t %${paneId}`)
        // Discover the new pane and trigger layout update
        await controller.refreshPanes()
    }

    private async closePane (paneTab: TmuxPaneTabComponent): Promise<void> {
        const controller = paneTab.controller
        if (!controller) return
        await controller.killPane(paneTab.paneId)
    }
}
