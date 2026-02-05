import * as yaml from 'js-yaml'
import axios from 'axios'
import * as crypto from 'crypto'
import { Injectable } from '@angular/core'
import { ConfigService, HostAppService, Logger, LogService, Platform, PlatformService } from 'tabby-core'

export interface User {
    id: number
}

export interface Config {
    id: number
    name: string
    content: string
    last_used_with_version: string|null
    created_at: Date
    modified_at: Date
}

const OPTIONAL_CONFIG_PARTS = ['hotkeys', 'appearance', 'vault']

@Injectable({ providedIn: 'root' })
export class ConfigSyncService {
    private logger: Logger
    private lastRemoteChange = {
        modified_at: new Date(0),
        digest: '',
    }

    constructor (
        log: LogService,
        private platform: PlatformService,
        private hostApp: HostAppService,
        private config: ConfigService,
    ) {
        this.logger = log.create('configSync')
        config.ready$.toPromise().then(() => {
            this.autoSync()
            config.changed$.subscribe(() => {
                if (this.isEnabled() && this.config.store.configSync.auto) {
                    this.upload()
                }
            })
        })
    }

    isAvailable (): boolean {
        return this.hostApp.platform !== Platform.Web
    }

    isEnabled (): boolean {
        return this.isAvailable() &&
            !!this.config.store.configSync.host &&
            !!this.config.store.configSync.token &&
            !!this.config.store.configSync.configID
    }

    async getConfigs (): Promise<Config[]> {
        return this.request('GET', '/api/1/configs')
    }

    async getConfig (id: number): Promise<Config> {
        return this.request('GET', `/api/1/configs/${id}`)
    }

    async updateConfig (id: number, data: Partial<Config>): Promise<Config> {
        return this.request('PATCH', `/api/1/configs/${id}`, { data })
    }

    async getUser (): Promise<any> {
        return this.request('GET', '/api/1/user')
    }

    async createNewConfig (name: string): Promise<Config> {
        return this.request('POST', '/api/1/configs', {
            data: {
                name,
            },
        })
    }

    async deleteConfig (id: number): Promise<any> {
        return this.request('DELETE', `/api/1/configs/${id}`)
    }

    setConfig (config: Config): void {
        this.config.store.configSync.configID = config.id
        this.config.save()
        this.lastRemoteChange.modified_at = new Date(config.modified_at)
    }

    async upload (): Promise<void> {
        if (!this.isEnabled()) {
            return
        }
        try {
            const localData = await this.readConfigDataForSync()
            // const remoteData = yaml.load((await this.getConfig(this.config.store.configSync.configID)).content) as any
            // for (const part of OPTIONAL_CONFIG_PARTS) {
            //     if (!this.config.store.configSync.parts[part]) {
            //         localData[part] = remoteData[part]
            //     }
            // }
            const content = yaml.dump(localData)
            const digest = this.hashContent(content)
            if (this.lastRemoteChange.digest === digest) {
                this.logger.info('Config unchanged, skipping upload')
                return
            }
            const result = await this.updateConfig(this.config.store.configSync.configID, {
                content,
                last_used_with_version: this.platform.getAppVersion(),
            })
            this.lastRemoteChange.modified_at = new Date(result.modified_at)
            this.lastRemoteChange.digest = digest
            this.logger.info('Config uploaded')
        } catch (error) {
            this.logger.error('Upload failed:', error)
            throw error
        }
    }

    async download (id: number): Promise<void> {
        if (!this.isEnabled()) {
            return
        }
        try {
            const remoteConfig = await this.getConfig(id)

            // const localData = yaml.load(this.config.readRaw()) as any
            // remoteData.configSync = localData.configSync

            // if (!remoteData.encrypted) {
            //     for (const part of OPTIONAL_CONFIG_PARTS) {
            //         if (!this.config.store.configSync.parts[part]) {
            //             // 原则上使用云端配置, 但部分设置(hotkeys, appearance, vault)可不同步到云端, 则使用local
            //             remoteData[part] = localData[part]
            //         }
            //     }
            // }

            if (id === this.config.store.configSync.configID) {
                if (new Date(remoteConfig.modified_at) > this.lastRemoteChange.modified_at) {
                    this.logger.debug(`Remote config changed at ${remoteConfig.modified_at}, syncing`)
                    await this.writeConfigDataFromSync(remoteConfig)
                } else {
                    this.logger.debug(`Remote config unchanged, skip update config`)
                }
            } else {
                await this.writeConfigDataFromSync(remoteConfig)
            }

            this.logger.debug('Config downloaded')
        } catch (error) {
            this.logger.error('Download failed:', error)
            throw error
        }
    }

    async delete (config: Config): Promise<void> {
        try {
            await this.deleteConfig(config.id)
            this.logger.debug('Config deleted')
        } catch (error) {
            this.logger.error('Delete failed:', error)
            throw error
        }
    }

    private async readConfigDataForSync (): Promise<any> {
        const data = yaml.load(await this.platform.loadConfig()) as any
        delete data.configSync
        return data
    }

    private async writeConfigDataFromSync (config: Config) {
        const remoteData = yaml.load(config.content) as any
        remoteData.configSync = this.config.store.configSync
        console.log(`111 remoteData.configSync:`, remoteData.configSync)
        await this.platform.saveConfig(yaml.dump(remoteData))
        await this.config.load()
        await this.config.save()
        this.lastRemoteChange.modified_at = new Date(config.modified_at)
        this.lastRemoteChange.digest = this.hashContent(config.content)
    }

    private async request (method: 'GET'|'POST'|'PATCH'|'DELETE', url: string, params = {}) {
        if (this.config.store.configSync.host.endsWith('/')) {
            this.config.store.configSync.host = this.config.store.configSync.host.slice(0, -1)
        }
        url = this.config.store.configSync.host + url
        this.logger.debug(`${method} ${url}`, params)
        try {
            const response = await axios.request({
                url,
                method,
                headers: {
                    Authorization: `Bearer ${this.config.store.configSync.token}`,
                },
                ...params,
            })
            this.logger.debug(response)
            return response.data
        } catch (error) {
            this.logger.error(error)
            throw error
        }
    }

    private async autoSync () {
        while (true) {
            try {
                if (this.isEnabled() && this.config.store.configSync.auto) {
                    this.download(this.config.store.configSync.configID)
                }
            } catch (error) {
                this.logger.debug('Recovering from autoSync network error')
            }
            await new Promise(resolve => setTimeout(resolve, 60000))
        }
    }

    private hashContent (content: string): string {
        return crypto.createHash('sha1').update(content, 'utf8').digest('hex')
    }
}
