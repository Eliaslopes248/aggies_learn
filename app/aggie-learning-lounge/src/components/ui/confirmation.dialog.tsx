// Copyright 2026, Elias Lopes
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//     * Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer
// in the documentation and/or other materials provided with the
// distribution.
//     * Neither the name of Elias Lopes nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
// FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
// COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
// INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
// BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
// LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
// CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
// LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
// ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

import { useId, useRef, type ReactNode } from 'react'

import { Button } from './controls.js'

type ConfirmationDialogProps = {
    triggerLabel: string
    title: string
    description: ReactNode
    confirmLabel: string
    destructive?: boolean
    onConfirm: () => void
}

/**
 * Open a native modal for an action that needs confirmation.
 * @param props Trigger, dialog text, and confirmation callback.
 */
export function ConfirmationDialog({
    triggerLabel,
    title,
    description,
    confirmLabel,
    destructive = false,
    onConfirm,
}: ConfirmationDialogProps) : React.JSX.Element
{
    const dialog = useRef<HTMLDialogElement>(null)
    const id = useId()

    return (
        <>
            <Button variant="secondary" onClick={() => dialog.current?.showModal()}>
                {triggerLabel}
            </Button>

            <dialog
                ref={dialog}
                className="confirmation-dialog"
                aria-labelledby={`${id}-title`}
                aria-describedby={`${id}-description`}
                onClose={event =>
                {
                    const modal = event.currentTarget
                    const confirmed = modal.returnValue === 'confirm'
                    // Clear the previous result before the next open or Escape dismissal.
                    modal.returnValue = ''

                    if (confirmed)
                    {
                        onConfirm()
                    }
                }}
            >
                <h2 id={`${id}-title`}>{title}</h2>
                <p id={`${id}-description`}>{description}</p>

                <form className="dialog-actions" method="dialog">
                    {/* Focus the safe action when the dialog opens. */}
                    <Button
                        type="submit"
                        value="cancel"
                        variant="secondary"
                        autoFocus
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        value="confirm"
                        variant={destructive ? 'danger' : 'primary'}
                    >
                        {confirmLabel}
                    </Button>
                </form>
            </dialog>
        </>
    )
}
