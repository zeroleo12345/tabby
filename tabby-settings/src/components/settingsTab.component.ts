/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import * as yaml from 'js-yaml'
import { debounce } from 'utils-decorators/dist/esm/debounce/debounce'
import { Component, ElementRef, Inject, Input, HostBinding, Injector, ViewChild } from '@angular/core'
import {
    ConfigService,
    BaseTabComponent,
    HostAppService,
    Platform,
    HomeBaseService,
    UpdaterService,
    PlatformService,
    HostWindowService,
    AppService,
    LocaleService,
    TranslateService,
    HotkeysService,
} from 'tabby-core'

import { SettingsTabProvider } from '../api'
import { ReleaseNotesComponent } from './releaseNotesTab.component'

/** @hidden */
@Component({
    selector: 'settings-tab',
    templateUrl: './settingsTab.component.pug',
    styleUrls: [
        './settingsTab.component.scss',
    ],
})
export class SettingsTabComponent extends BaseTabComponent {
    @Input() activeTab: string
    @ViewChild('configFileInput') configFileInput?: ElementRef<HTMLTextAreaElement>
    Platform = Platform
    configDefaults: any
    configFile: string
    isShellIntegrationInstalled = false
    checkingForUpdate = false
    updateAvailable = false
    showConfigDefaults = false
    allLanguages = LocaleService.allLanguages
    @HostBinding('class.pad-window-controls') padWindowControls = false

    constructor (
        public config: ConfigService,
        public hostApp: HostAppService,
        public hostWindow: HostWindowService,
        public homeBase: HomeBaseService,
        public platform: PlatformService,
        public locale: LocaleService,
        public updater: UpdaterService,
        private app: AppService,
        private hotkeys: HotkeysService,
        @Inject(SettingsTabProvider) public settingsProviders: SettingsTabProvider[],
        translate: TranslateService,
        injector: Injector,
    ) {
        super(injector)
        this.setTitle(translate.instant(_('Settings')))
        this.settingsProviders = config.enabledServices(this.settingsProviders)
        this.settingsProviders = this.settingsProviders.filter(x => !!x.getComponentType())
        this.settingsProviders.sort((a, b) => a.weight - b.weight + a.title.localeCompare(b.title))

        this.configDefaults = yaml.dump(config.getDefaults())

        const onConfigChange = () => {
            this.configFile = config.readRaw()
            this.padWindowControls = hostApp.platform === Platform.macOS
                && config.store.appearance.tabsLocation !== 'top'
        }

        this.subscribeUntilDestroyed(config.changed$, onConfigChange)
        this.subscribeUntilDestroyed(this.hotkeys.unfilteredHotkey$, hotkey => {
            if (hotkey === 'select-all' && this.configInputFocused()) {
                this.selectAllConfig()
            }
        })
        onConfigChange()
    }

    async ngOnInit () {
        this.isShellIntegrationInstalled = await this.platform.isShellIntegrationInstalled()
    }

    async toggleShellIntegration () {
        if (!this.isShellIntegrationInstalled) {
            await this.platform.installShellIntegration()
        } else {
            await this.platform.uninstallShellIntegration()
        }
        this.isShellIntegrationInstalled = await this.platform.isShellIntegrationInstalled()
    }

    ngOnDestroy () {
        this.config.save()
    }

    restartApp () {
        this.hostApp.relaunch()
    }

    @debounce(500)
    saveConfiguration (requireRestart?: boolean) {
        this.config.save()
        if (requireRestart) {
            this.config.requestRestart()
        }
    }

    saveConfigFile () {
        if (this.isConfigFileValid()) {
            this.config.writeRaw(this.configFile)
        }
    }

    showConfigFile () {
        this.platform.showItemInFolder(this.platform.getConfigPath()!)
    }

    configInputFocused () {
        return this.hasFocus && document.activeElement === this.configFileInput?.nativeElement
    }

    selectAllConfig () {
        this.configFileInput?.nativeElement.select()
    }

    isConfigFileValid () {
        try {
            yaml.load(this.configFile)
            return true
        } catch {
            return false
        }
    }

    async checkForUpdates () {
        this.checkingForUpdate = true
        this.updateAvailable = await this.updater.check()
        this.checkingForUpdate = false
    }

    showReleaseNotes () {
        this.app.openNewTabRaw({
            type: ReleaseNotesComponent,
        })
    }
}
