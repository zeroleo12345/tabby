/* eslint-disable @typescript-eslint/no-type-alias */
export const metaKeyName = {
    darwin: '⌘',
    win32: 'Win',
    linux: 'Super',
}[process.platform]

export const altKeyName = {
    darwin: '⌥',
    win32: 'Alt',
    linux: 'Alt',
}[process.platform]

export interface KeyEventData {
    ctrlKey?: boolean
    metaKey?: boolean
    altKey?: boolean
    shiftKey?: boolean
    key: string
    code: string
    eventName: string
    time: number
    registrationTime: number
}

const REGEX_LATIN_KEYNAME = /^[A-Za-z]$/

export type KeyName = string
export type Keystroke = string

export function getKeyName (event: KeyboardEvent): KeyName {
    // eslint-disable-next-line @typescript-eslint/init-declarations
    switch (event.key) {
        case 'Control': return 'Ctrl'
        case 'Meta': return metaKeyName
        case 'Alt': return altKeyName
        case 'Shift': return 'Shift'
        case '`': return '`'
        case '~': return '~'
        default:
            let key = event.code
            if (REGEX_LATIN_KEYNAME.test(event.key)) {
                // Handle Dvorak etc via the reported "character" instead of the scancode
                key = event.key.toUpperCase()
            } else {
                key = key.replace('Key', '')
                key = key.replace('Arrow', '')
                key = key.replace('Digit', '')
                key = {
                    Comma: ',',
                    Period: '.',
                    Slash: '/',
                    Backslash: '\\',
                    IntlBackslash: '`',
                    Minus: '-',
                    Equal: '=',
                    Semicolon: ';',
                    Quote: '\'',
                    BracketLeft: '[',
                    BracketRight: ']',
                }[key] ?? key
            }
            return key
    }
}

export function getKeystrokeName (keys: KeyName[]): Keystroke {
    const strictOrdering: KeyName[] = ['Ctrl', metaKeyName, altKeyName, 'Shift']
    keys = [
        ...strictOrdering.map(x => keys.find(k => k === x)).filter(x => !!x) as KeyName[],
        ...keys.filter(k => !strictOrdering.includes(k)),
    ]
    return keys.join('-')
}
