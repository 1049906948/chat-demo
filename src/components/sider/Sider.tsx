import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCloseOutline16,
  IconListSelectOutline16,
  IconPanelLeftOutline16,
  IconSettingsOutline16,
  IconTrashOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => new Set())
  const [deletingSelected, setDeletingSelected] = useState(false)
  const [batchDeleteCount, setBatchDeleteCount] = useState(0)
  const [batchDeletePending, setBatchDeletePending] = useState(false)
  const selectedCount = sessions.reduce(
    (count, session) => count + Number(selectedSessionIds.has(session.id)),
    0
  )
  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedSessionIds(new Set())
  }

  const toggleSelectedSession = (id: string) => {
    setSelectedSessionIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const deleteSelectedSessions = async () => {
    const ids = sessions.filter((session) => selectedSessionIds.has(session.id)).map(({ id }) => id)
    setBatchDeletePending(true)
    const failedIds: string[] = []
    try {
      for (const id of ids) {
        try {
          if (!(await removeSession(id))) {
            failedIds.push(id)
          }
        } catch {
          failedIds.push(id)
        }
      }
      const remainingIds = new Set(useChatStore.getState().sessions.map(({ id }) => id))
      const remainingFailures = failedIds.filter((id) => remainingIds.has(id))
      setDeletingSelected(false)
      if (remainingFailures.length > 0) {
        setSelectedSessionIds(new Set(remainingFailures))
        showToast({ key: 'sessionDeleteFailed', type: 'error' })
      } else {
        exitSelectionMode()
      }
    } finally {
      setBatchDeletePending(false)
    }
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{t('appName')}</div>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      {selectionMode ? (
        <div className={styles.selectionHeader}>
          <span className={styles.selectionTitle}>{t('selectSessions')}</span>
          <div className={styles.selectionActions}>
            {selectedCount > 0 ? (
              <IconButton
                icon={<IconTrashOutline16 />}
                tooltip={t('deleteSelectedSessions')}
                disabled={batchDeletePending}
                onClick={() => {
                  setBatchDeleteCount(selectedCount)
                  setDeletingSelected(true)
                }}
              />
            ) : null}
            <IconButton
              className={styles.selectionClose}
              icon={<IconCloseOutline16 />}
              tooltip={t('cancelSelection')}
              disabled={batchDeletePending}
              onClick={exitSelectionMode}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.newChat}
          onClick={() => {
            newChat()
            closeMobileSider()
          }}
        >
          <span className={styles.newChatIcon}>
            <NewChatIcon />
          </span>
          {t('newChat')}
        </button>
      )}
      <div className={clsx(styles.listWrap, selectionMode && styles.selectionListWrap)}>
        <div className={styles.list}>
          {groups.map((group, index) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}>
                <span>{group.label}</span>
                {index === 0 && !selectionMode ? (
                  <IconButton
                    className={styles.sectionSelectButton}
                    size="m"
                    icon={<IconListSelectOutline16 />}
                    tooltip={t('selectSessions')}
                    tooltipPlacement="bottom"
                    aria-pressed={false}
                    onClick={() => setSelectionMode(true)}
                  />
                ) : null}
              </div>
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={session.id === activeId && !selectionMode}
                  selectionMode={selectionMode}
                  selected={selectedSessionIds.has(session.id)}
                  onToggleSelected={() => toggleSelectedSession(session.id)}
                  onDelete={() => setDeleting(session)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.bottom}>
        <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
      {deletingSelected ? (
        <Modal
          title={t('deleteSelectedSessionsModalTitle', { count: batchDeleteCount })}
          onClose={() => {
            if (!batchDeletePending) {
              setDeletingSelected(false)
            }
          }}
          footer={
            <>
              <Button
                variant="outlined"
                disabled={batchDeletePending}
                onClick={() => setDeletingSelected(false)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={batchDeletePending || selectedCount === 0}
                onClick={() => void deleteSelectedSessions()}
              >
                {t(batchDeletePending ? 'historyDeleting' : 'delete')}
              </Button>
            </>
          }
        >
          {t('deleteSelectedSessionsDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile />
      </div>
    </>
  )
}
