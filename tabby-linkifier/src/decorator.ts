import { Inject, Injectable } from '@angular/core'
import { ConfigService, PlatformService } from 'tabby-core'
import { TerminalDecorator, BaseTerminalTabComponent, XTermFrontend } from 'tabby-terminal'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { LinkHandler } from './api'

@Injectable()
export class LinkHighlighterDecorator extends TerminalDecorator {
    constructor (
        private config: ConfigService,
        private platform: PlatformService,
        @Inject(LinkHandler) private handlers: LinkHandler[],
    ) {
        super()
    }

    attach (tab: BaseTerminalTabComponent<any>): void {
        if (!(tab.frontend instanceof XTermFrontend)) {
            // not xterm
            return
        }

        let lastLinkClickAt = 0
        const markLinkClick = () => {
            lastLinkClickAt = Date.now()
        }
        const maybeClearSelection = () => {
            if (!lastLinkClickAt) {
                return
            }
            if (Date.now() - lastLinkClickAt > 2000) {
                return
            }
            tab.frontend.xterm.clearSelection()
        }

        tab.frontend.xterm.options.linkHandler = {
            activate: (event, uri) => {
                if (!this.willHandleEvent(event)) {
                    return
                }
                this.swallowEvent(event)
                markLinkClick()
                tab.frontend.xterm.clearSelection()
                this.platform.openExternal(uri)
            },
        }

        const openLink = async uri => {
            for (const handler of this.handlers) {
                if (!handler.fullMatchRegex.test(uri)) {
                    continue
                }
                if (!await handler.verify(await handler.convert(uri, tab), tab)) {
                    continue
                }
                handler.handle(await handler.convert(uri, tab), tab)
            }
        }

        let regex = new RegExp('')
        const regexSource = this.handlers.map(x => `(${x.regex.source})`).join('|')
        try {
            regex = new RegExp(regexSource)
            console.debug('Linkifier regexp', regex)
        } catch (error) {
            console.error('Could not build regex for your link handlers:', error)
            console.error('Regex source was:', regexSource)
            return
        }

        const addon = new WebLinksAddon(
            async (event, uri) => {
                if (!this.willHandleEvent(event)) {
                    return
                }
                this.swallowEvent(event)
                markLinkClick()
                tab.frontend.xterm.clearSelection()
                openLink(uri)
            },
            {
                urlRegex: regex,
            },
        )

        tab.frontend.xterm.loadAddon(addon)
        window.addEventListener('blur', maybeClearSelection, true)
        window.addEventListener('focus', maybeClearSelection, true)
    }

    private willHandleEvent (event: MouseEvent) {
        const modifier = this.config.store.clickableLinks.modifier
        return !modifier || event[modifier]
    }

    private swallowEvent (event: MouseEvent): void {
        if (event.cancelable) {
            event.preventDefault()
        }
        event.stopPropagation()
    }
}
