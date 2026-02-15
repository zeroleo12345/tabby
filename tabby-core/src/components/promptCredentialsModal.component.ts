import { Component, Input, ViewChild, ElementRef } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

/** @hidden */
@Component({
    templateUrl: './promptCredentialsModal.component.pug',
})
export class PromptCredentialsModalComponent {
    @Input() username: string
    @Input() password: string
    @Input() remember: boolean
    @Input() showRememberCheckbox = true
    @ViewChild('usernameInput') usernameInput: ElementRef
    @ViewChild('passwordInput') passwordInput: ElementRef

    constructor (
        private modalInstance: NgbActiveModal,
    ) { }

    ngOnInit (): void {
        this.username ??= this.username
        this.password ??= this.password
        setTimeout(() => {
            if (!this.username) {
                this.usernameInput.nativeElement.focus()
            } else {
                this.passwordInput.nativeElement.focus()
            }
        })
    }

    ok (): void {
        this.modalInstance.close({
            username: this.username,
            password: this.password,
            remember: this.remember,
        })
    }

    cancel (): void {
        this.modalInstance.close(null)
    }
}
