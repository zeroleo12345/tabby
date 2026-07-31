import { Component, Input, ElementRef, ViewChild } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

@Component({
    selector: 'tmux-rename-window-modal',
    template: `
        <div class="modal-body">
            <input
                class="form-control"
                type="text"
                #input
                [(ngModel)]="value"
                (keyup.enter)="save()"
                autofocus
            >
        </div>

        <div class="modal-footer">
            <button class="btn btn-primary" (click)="save()">Save</button>
            <button class="btn btn-secondary" (click)="close()">Cancel</button>
        </div>
    `,
})
export class TmuxRenameWindowModalComponent {
    @Input() value: string
    @ViewChild('input') input: ElementRef

    constructor (
        private modalInstance: NgbActiveModal,
    ) { }

    ngOnInit (): void {
        setTimeout(() => {
            this.input.nativeElement.focus()
            this.input.nativeElement.select()
        }, 250)
    }

    save (): void {
        this.modalInstance.close(this.value)
    }

    close (): void {
        this.modalInstance.dismiss()
    }
}
