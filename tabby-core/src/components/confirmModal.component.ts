import { Component, Input } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

@Component({
    selector: 'confirm-modal',
    templateUrl: './confirmModal.component.pug',
    styleUrls: ['./confirmModal.component.scss'],
})
export class ConfirmModalComponent {
    @Input() message: string
    @Input() detail?: string
    @Input() confirmButton: string
    @Input() cancelButton: string
    @Input() confirmClass = 'btn-primary'

    constructor (
        private modalInstance: NgbActiveModal,
    ) { }

    confirm (): void {
        this.modalInstance.close(true)
    }

    cancel (): void {
        this.modalInstance.close(false)
    }
}
