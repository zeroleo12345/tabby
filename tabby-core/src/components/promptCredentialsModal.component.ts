import { Component, Input, ViewChild, ElementRef, AfterViewInit } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

/** @hidden */
@Component({
    templateUrl: './promptCredentialsModal.component.pug',
})
export class PromptCredentialsModalComponent implements AfterViewInit {
    @Input() username: string
    @Input() usernamePrompt = 'username:'
    @Input() password: string
    @Input() passwordPrompt = 'password:'
    @Input() remember = true
    @Input() showRememberCheckbox = true
    @ViewChild('usernameInput') usernameInput: ElementRef
    @ViewChild('passwordInput') passwordInput: ElementRef

    constructor (
        private modalInstance: NgbActiveModal,
    ) { }

    ngAfterViewInit (): void {
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
