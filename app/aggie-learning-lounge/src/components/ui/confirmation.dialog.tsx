import { useId, useRef } from 'react'

import { Button } from './controls.js'

type ConfirmationDialogProps = {
    triggerLabel: string
    title: string
    description: string
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
