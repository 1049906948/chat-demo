import clsx from 'clsx'
import { memo, useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconEditOutline16, IconEllipsisOutline16, IconTrashOutline16 } from '../base/icons.js'
import { renameSession, selectSession } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionItem.module.css'

export const SessionItem = memo(function SessionItem({
  session,
  active,
  selectionMode,
  selected,
  onToggleSelected,
  onDelete,
}: {
  session: SessionSummary
  active: boolean
  selectionMode: boolean
  selected: boolean
  onToggleSelected: () => void
  onDelete: () => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const displayTitle = session.title || t('untitledChat')

  useEffect(() => {
    if (selectionMode) {
      setEditing(false)
    }
  }, [selectionMode])

  if (editing && !selectionMode) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div
      className={clsx(styles.item, active && styles.active)}
      onClick={() => {
        if (selectionMode) {
          onToggleSelected()
          return
        }
        selectSession(session.id)
        closeMobileSider()
      }}
    >
      {selectionMode ? (
        <input
          className={styles.checkbox}
          type="checkbox"
          checked={selected}
          aria-label={t('selectSession', { title: displayTitle })}
          onClick={(event) => event.stopPropagation()}
          onChange={onToggleSelected}
        />
      ) : null}
      <div className={styles.title}>{displayTitle}</div>
      {!selectionMode ? (
        <div className={styles.action} onClick={(event) => event.stopPropagation()}>
          <Menu
            options={[
              {
                key: 'rename',
                label: t('sessionItemMenuRenameOption'),
                icon: <IconEditOutline16 />,
                onSelect: () => setEditing(true),
              },
              {
                key: 'delete',
                label: t('delete'),
                icon: <IconTrashOutline16 />,
                danger: true,
                onSelect: onDelete,
              },
            ]}
          >
            {({ toggle }) => (
              <IconButton
                icon={<IconEllipsisOutline16 />}
                aria-label={t('more')}
                onClick={toggle}
              />
            )}
          </Menu>
        </div>
      ) : null}
    </div>
  )
})
