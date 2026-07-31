import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import TabbyCoreModule, { AppService, TabContextMenuItemProvider, ConfigProvider, HotkeysService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { TerminalDecorator } from 'tabby-terminal'
import { TmuxContextMenuProvider } from './tabContextMenu'
import { TmuxConfigProvider } from './config'
import { TmuxSettingsTabProvider } from './settings'
import { TmuxDecorator } from './decorator'
import { TmuxPaneTabComponent } from './components/tmuxPaneTab.component'
import { TmuxSessionTabComponent } from './components/tmuxSessionTab.component'
import { TmuxWindowBarComponent } from './components/tmuxWindowBar.component'
import { TmuxSettingsTabComponent } from './components/settings.component'

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        TabbyCoreModule,
    ],
    providers: [
        { provide: TabContextMenuItemProvider, useClass: TmuxContextMenuProvider, multi: true },
        { provide: TerminalDecorator, useClass: TmuxDecorator, multi: true },
        { provide: ConfigProvider, useClass: TmuxConfigProvider, multi: true },
        { provide: SettingsTabProvider, useClass: TmuxSettingsTabProvider, multi: true },
    ],
    declarations: [
        TmuxPaneTabComponent,
        TmuxSessionTabComponent,
        TmuxWindowBarComponent,
        TmuxSettingsTabComponent,
    ],
    entryComponents: [
        TmuxPaneTabComponent,
        TmuxSessionTabComponent,
        TmuxSettingsTabComponent,
    ],
})
export default class TmuxModule {
    constructor (
        hotkeys: HotkeysService,
        app: AppService,
    ) {
        hotkeys.hotkey$.subscribe(async hotkey => {
            if (hotkey !== 'duplicate-tab') {
                return
            }

            const activeTab = app.activeTab
            if (activeTab instanceof TmuxSessionTabComponent) {
                await activeTab.onDuplicateWindow()
            }
        })
    }
}
