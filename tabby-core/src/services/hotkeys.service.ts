import { Injectable, Inject, NgZone, EventEmitter } from '@angular/core'
import { Observable, Subject, filter } from 'rxjs'
import { HotkeyDescription, HotkeyProvider } from '../api/hotkeyProvider'
import { getKeyName, Keystroke, KeyName, metaKeyName, altKeyName, getKeystrokeName, KeyEventData } from './hotkeys.util'
import { ConfigService } from './config.service'
import { HostAppService, Platform } from '../api/hostApp'
import { deprecate } from 'util'

export interface PartialHotkeyMatch {
    id: string
    strokes: string[]
    matchedLength: number
}

interface PastKeystroke {
    keystroke: Keystroke
    time: number
}

@Injectable({ providedIn: 'root' })
export class HotkeysService {
    /** @hidden @deprecated */
    key = new EventEmitter<KeyboardEvent>()

    /** @hidden @deprecated */
    matchedHotkey = new EventEmitter<string>()

    /**
     * Context key for each component status
     */
    contextKey = new Map<KeyName, boolean>()

    /**
     * Fired for each recognized hotkey
     */
    get unfilteredHotkey$ (): Observable<string> { return this._hotkey }

    /**
     * Fired for each recognized hotkey
     */
    get hotkey$ (): Observable<string> {
        return this._hotkey.pipe(filter(() => {
            return document.querySelectorAll('input:focus').length === 0
        }))
    }

    /**
     * Fired for once hotkey is released
     */
    get hotkeyOff$ (): Observable<string> { return this._hotkeyOff }

    /**
     * Fired for each singular key
     */
    get key$ (): Observable<KeyName> { return this._key }

    /**
     * Fired for each key event
     */
    get keyEvent$ (): Observable<KeyboardEvent> { return this._keyEvent }

    /**
     * Fired for each singular key combination
     */
    get keystroke$ (): Observable<Keystroke> { return this._keystroke }

    private _hotkey = new Subject<string>()
    private _hotkeyOff = new Subject<string>()
    private _keyEvent = new Subject<KeyboardEvent>()
    private _key = new Subject<KeyName>()
    private _keystroke = new Subject<Keystroke>()
    private toggle = 0
    private hotkeyDescriptions: HotkeyDescription[] = []
    private hotkeyConfig = {}

    private pressedKey: KeyboardEvent|null
    private lastEventTimestamp = 0

    private constructor (
        private zone: NgZone,
        private config: ConfigService,
        @Inject(HotkeyProvider) private hotkeyProviders: HotkeyProvider[],
        hostApp: HostAppService,
    ) {
        this.config.ready$.toPromise().then(async () => {
            const hotkeys = await this.getHotkeyDescriptions()
            this.hotkeyDescriptions = hotkeys
            const events = ['keydown', 'keyup']

            events.forEach(eventType => {
                window.addEventListener(eventType, (nativeEvent: KeyboardEvent) => {
                    // console.log(`111 keyboard non-xterm.js:", nativeEvent)
                    this.propagationKeyEventHandler(eventType, nativeEvent)
                })
            })
            this.hotkeyConfig = this.getHotkeysConfig()
        })
        this.config.changed$.subscribe(() => {
            this.hotkeyConfig = this.getHotkeysConfig()
        })

        // deprecated
        // this.hotkey$.subscribe(h => this.matchedHotkey.emit(h))
        this.matchedHotkey.subscribe(() => {
            this.hotkeyConfig = this.getHotkeysConfig()
        })
        this.keyEvent$.subscribe(h => this.key.next(h))
        this.key.subscribe = deprecate(s => this.keyEvent$.subscribe(s), 'key is deprecated, use keyEvent$')
    }

    propagationKeyEventHandler (eventName: string, nativeEvent: KeyboardEvent): boolean {
        const isHotkey = this.isHotkeyEvent(eventName, nativeEvent)
        if (isHotkey) {
            // console.log(`111 hotkey matched. preventDefault and stopPropagation:`, nativeEvent)
            nativeEvent.preventDefault()
            nativeEvent.stopPropagation()
            return false
        } else if (this.isRefresh(nativeEvent)) {
            // Prevent Ctrl+W closing window / Ctrl+N opening new window in PWA.
            // (No effect in a regular browser tab.)
            nativeEvent.preventDefault()
            return false
        }
        return true
    }

    /**
     * @param {KeyboardEvent} e
     * @return {boolean}
     */
    isRefresh (e) {
        // 116: keyCode of "F5"
        return e.keyCode === 116;
    }

    /**
     * Adds a new key event to the buffer
     *
     * @param eventName DOM event name
     * @param nativeEvent event object, https://developer.mozilla.org/zh-CN/docs/Web/API/KeyboardEvent
     * @return true : preventDefault();
     */
    isHotkeyEvent (eventName: string, nativeEvent: KeyboardEvent): boolean {
        if (nativeEvent.timeStamp === this.lastEventTimestamp) {
            return false
        }
        this.lastEventTimestamp = nativeEvent.timeStamp

        let keyTips = `111 isHotkeyEvent eventName: ${eventName}, code: ${nativeEvent.code}`
        keyTips += nativeEvent.ctrlKey ? ', ctrlKey: true' : ''
        keyTips += nativeEvent.altKey ? ', altKey: true' : ''
        keyTips += nativeEvent.shiftKey ? ', shiftKey: true' : ''
        keyTips += nativeEvent.metaKey ? ', metaKey: true' : ''
        console.log(keyTips)
        console.log('pressedKey: ', this.pressedKey)

        if (eventName === 'keydown') {
            // (f up) (Meta up) (Meta+f down) (Meta down) (Alt up) (Alt down)
            if (nativeEvent.ctrlKey && nativeEvent.key != 'Control') {
                this.pressedKey = nativeEvent
            }
            if (nativeEvent.metaKey && nativeEvent.key != 'Meta') {
                this.pressedKey = nativeEvent
            }
            if (nativeEvent.altKey && nativeEvent.key != 'Alt') {
                this.pressedKey = nativeEvent
            }
            if (nativeEvent.shiftKey && nativeEvent.key != 'Shift') {
                this.pressedKey = nativeEvent
            }
            if (this.pressedKey) {
                let hotkey = this.matchActiveHotkey(this.pressedKey)
                if (['select-all'].includes(hotkey) && this.contextKey['terminalTabFocus'] === false) {
                    // only terminal tab focus, hotkey "select-all" work, else return
                    hotkey = ''
                }
                if (hotkey) {
                    this.zone.run(() => {
                        this.emitHotkeyOn(hotkey)
                    })
                    return true
                }
            }
            return false
        } else if (eventName === 'keyup') {
            // TODO
            // this._keystroke.next(nativeEvent)
            // else {
            //     this.zone.run(() => {
            //         this.emitHotkeyOff(hotkey)
            //     })
            // }

            // this.zone.run(() => {
            //     this._key.next(keyName)
            // })

            // if (process.platform === 'darwin' && nativeEvent.metaKey && eventName === 'keydown' &&
            //     !['Ctrl', 'Shift', altKeyName, metaKeyName, 'Enter'].includes(keyName)
            // ) {
            //     // macOS will swallow non-modified keyups if Cmd is held down
            //     this.isHotkeyEvent('keyup', nativeEvent)
            // }
            this.pressedKey = null
            return true
        }
        return false
    }

    matchActiveHotkey (pressedKey: KeyboardEvent): string {
        if (!this.isEnabled()) {
            return ''
        }
        const currentSequence = getKeystrokeName(pressedKey)
        console.log(`111 currentSequence:`, currentSequence)
        // console.log(`111 all hotkeys:`, this.hotkeyConfig)
        // TODO use Set or Map for performance improved
        for (const hotkey_id in this.hotkeyConfig) {
            for (const sequence of this.hotkeyConfig[hotkey_id]) {
                // 遍历 hotkeys[] 数组内每一个hotkey, 如 Alt-O
                // console.log(`111 hotkey name: ${hotkey_id}`)
                // console.log(`111 input: ${currentSequence}, ${currentSequence.length})
                // console.log(`111 config: ${sequence}, ${sequence.length})
                if (currentSequence.length < sequence.length) {
                    continue
                }
                // console.log(`111 config: ${sequence}, length: ${sequence.length})
                for (const item of sequence) {
                    if (currentSequence === item) {
                        return hotkey_id
                    }
                }
            }
        }
        return ''
    }

    clearCurrentKeystrokes (): void {
        this.pressedKey = null
    }

    getHotkeyDescription (id: string): HotkeyDescription {
        return this.hotkeyDescriptions.filter((x) => x.id === id)[0]
    }

    enable (): void {
        this.toggle = 1
    }

    disable (): void {
        this.toggle = 0
    }

    isEnabled (): boolean {
        return this.toggle === 0
    }

    async getHotkeyDescriptions (): Promise<HotkeyDescription[]> {
        return (
            await Promise.all(
                this.config.enabledServices(this.hotkeyProviders)
                    .map(async x => x.provide()),
            )
        ).reduce((a, b) => a.concat(b))
    }

    private emitHotkeyOn (hotkey: string) {
        console.info(`Matched hotkey '${hotkey}'`)
        this._hotkey.next(hotkey)
    }

    private emitHotkeyOff (hotkey: string) {
        console.info(`Unmatched hotkey '${hotkey}'`)
        this._hotkeyOff.next(hotkey)
    }

    private getHotkeysConfig () {
        return this.getHotkeysConfigRecursive(this.config.store.hotkeys)
    }

    private getHotkeysConfigRecursive (branch: any) {
        const keys = {}
        for (const key in branch) {
            let value = branch[key]
            if (value instanceof Object && !(value instanceof Array)) {
                const subkeys = this.getHotkeysConfigRecursive(value)
                for (const subkey in subkeys) {
                    keys[key + '.' + subkey] = subkeys[subkey]
                }
            } else {
                if (typeof value === 'string') {
                    value = [value]
                }
                if (!(value instanceof Array)) {
                    continue
                }
                if (value.length > 0) {
                    value = value.map((item: string | string[]) => typeof item === 'string' ? [item] : item)
                    keys[key] = value
                }
            }
        }
        return keys
    }
}
