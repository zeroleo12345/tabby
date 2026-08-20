import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges, ChangeDetectorRef } from '@angular/core'
import { Subscription } from 'rxjs'
import { TmuxController } from '../session'

interface WindowInfo {
    id: number
    name: string
    paneCount: number
}

@Component({
    selector: 'tmux-window-bar',
    template: `
        <div class="window-bar" *ngIf="windows.length">
            <span class="status-label">Detached tmux windows</span>
            <div class="window-tabs">
                <button
                    *ngFor="let win of windows; trackBy: trackByWindowId"
                    class="window-tab"
                    (click)="windowOpen.emit(win.id)"
                    (contextmenu)="onContextMenu($event, win)"
                    title="Reopen this tmux window in a terminal tab"
                >
                    <span class="window-name">{{ win.name }}</span>
                    <span class="pane-badge" *ngIf="win.paneCount > 1">{{ win.paneCount }}</span>
                    <span class="window-close" title="Close Window" (click)="onCloseWindow($event, win)">
                        <i class="fas fa-times"></i>
                    </span>
                </button>
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            flex: 0 0 auto;
        }
        .window-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 2px 8px;
            background: rgba(30, 30, 30, 0.95);
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            min-height: 28px;
            overflow-x: auto;
        }
        .window-tabs {
            display: flex;
            align-items: center;
            gap: 2px;
            overflow-x: auto;
            flex: 1;
            min-width: 0;
        }
        .status-label {
            flex: 0 0 auto;
            margin-right: 8px;
            color: #777;
            font-size: 0.78em;
            white-space: nowrap;
        }
        .window-tab {
            display: flex;
            align-items: center;
            gap: 4px;
            height: 22px;
            padding: 0 8px;
            border: 1px solid transparent;
            border-radius: 3px;
            background: transparent;
            color: #999;
            font-size: 0.82em;
            cursor: pointer;
            white-space: nowrap;
            transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .window-tab:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #ccc;
        }
        .pane-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 16px;
            height: 16px;
            padding: 0 3px;
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.1);
            font-size: 0.85em;
            color: #aaa;
        }
        .window-close {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-left: auto;
            margin-right: -4px;
            width: 14px;
            height: 14px;
            border-radius: 2px;
            font-size: 0.7em;
            color: transparent;
            cursor: pointer;
            visibility: hidden;
        }
        .window-tab:hover .window-close {
            visibility: visible;
            color: #888;
        }
        .window-close:hover {
            background: rgba(255, 80, 80, 0.3);
            color: #f66;
        }
    `]
})
export class TmuxWindowBarComponent implements OnInit, OnDestroy, OnChanges {
    @Input() controller: TmuxController
    /** Window IDs currently represented by a native terminal tab. */
    @Input() attachedWindowIds: number[] = []

    @Output() windowOpen = new EventEmitter<number>()
    @Output() windowClose = new EventEmitter<number>()

    windows: WindowInfo[] = []

    private subscription: Subscription

    constructor(private cdr: ChangeDetectorRef) {}

    ngOnInit(): void {
        this.refreshWindows()

        if (!this.controller) {
            return
        }

        this.subscription = this.controller.events.subscribe(event => {
            switch (event.type) {
                case 'window-add':
                case 'window-close':
                case 'window-renamed':
                case 'pane-add':
                case 'pane-close':
                case 'initialized':
                    this.refreshWindows()
                    break
                case 'layout-change':
                    // Layout changes may affect pane count display
                    // (e.g. zoom shows fewer panes in layout, but real count is unchanged)
                    this.refreshWindows()
                    break
            }
        })
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes.controller || changes.attachedWindowIds) {
            this.refreshWindows()
        }
    }

    ngOnDestroy(): void {
        this.subscription?.unsubscribe()
    }

    private refreshWindows(): void {
        if (!this.controller) {
            this.windows = []
            // This method can be called from ngOnChanges. Running a synchronous
            // change detection pass there recreates the hovered button and makes
            // its hover state flicker. Let Angular render on its normal pass.
            this.cdr.markForCheck()
            return
        }

        const attachedWindowIds = new Set(this.attachedWindowIds)
        const windowStates = this.controller.getAllWindowStates()
        this.windows = windowStates.filter(ws => !attachedWindowIds.has(ws.id)).map(ws => ({
            id: ws.id,
            name: ws.name,
            paneCount: ws.panes.size,
        }))
        this.cdr.markForCheck()
    }

    onCloseWindow(event: MouseEvent, win: WindowInfo): void {
        event.stopPropagation()
        this.windowClose.emit(win.id)
    }

    /** Keep a hovered button's DOM node stable across parent change detection. */
    trackByWindowId (_index: number, win: WindowInfo): number {
        return win.id
    }

    onContextMenu(event: MouseEvent, _win: WindowInfo): void {
        // Reserved for future context menu (rename, close window, etc.)
        event.preventDefault()
    }
}
