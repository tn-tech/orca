import React from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

/** F9: leaves the run view for editing; the run stays in History. Lives in the editing-tools
 *  group, which has room to spare in every toolbar width the run group would not. */
export default function BackToEditingButton({
  onClick
}: {
  onClick: () => void
}): React.JSX.Element {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick}>
      <ArrowLeft />
      {translate('auto.components.workflows.run-view.RunToolbar.backToEditing', 'Back to editing')}
    </Button>
  )
}
