import { useId, useState } from 'react'
import { IconEditOutline16 } from '../base/icons.js'
import { useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { IconButton } from '../base/IconButton.js'
import { useApiKeyForm } from './useApiKeyForm.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './Settings.module.css'

/** API Key 的编辑状态：输入框与移动端底部的「确定」按钮共用 */
export const useApiKeyEditor = () => {
  const apiKey = useSettings((state) => state.apiKey)
  const provider = useSettings((state) => state.apiProvider)
  const apiBaseUrl = useSettings((state) => state.apiBaseUrl)
  const model = useSettings((state) => state.apiModel)
  const config = { provider, apiBaseUrl, apiKey, model }
  const [editing, setEditing] = useState(false)
  const form = useApiKeyForm(config, () => setEditing(false))
  return { apiKey, config, editing, setEditing, form, showInput: !apiKey || editing }
}

type ApiKeyEditor = ReturnType<typeof useApiKeyEditor>

/** API Key：保存后只显示掩码，点编辑按钮才能重新输入 */
export const ApiKeyField = ({ editor }: { editor: ApiKeyEditor }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const apiKeyId = useId()
  const { apiKey, config, editing, setEditing, form, showInput } = editor

  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.label}>{t('apiKeyStart')}</div>
        <div className={styles.description}>{t('apiConfigHelp')}</div>
        {apiKey && !editing ? (
          <div className={styles.apiKeySaved}>
            <div className={styles.apiConfigSummary}>
              <strong>
                {config.provider === 'deepseek'
                  ? 'DeepSeek'
                  : config.provider === 'aliyun'
                    ? '阿里云百炼'
                    : 'Custom API'}
              </strong>
              <span className={styles.apiKeyMask}>{'*'.repeat(apiKey.length)}</span>
              <span className={styles.apiConfigMeta}>{config.model}</span>
            </div>
            <IconButton
              tone="primary"
              icon={<IconEditOutline16 />}
              tooltip={t('apiKeyEdit')}
              onClick={() => setEditing(true)}
            />
          </div>
        ) : (
          <div className={styles.apiConfigFields}>
            <label className={styles.apiConfigField}>
              <span>{t('apiProvider')}</span>
              <select
                disabled={form.verifying}
                value={form.provider}
                onChange={(event) => form.setProvider(event.target.value as typeof form.provider)}
              >
                <option value="deepseek">DeepSeek</option>
                <option value="aliyun">阿里云百炼</option>
                <option value="custom">{t('customApi')}</option>
              </select>
            </label>
            <label className={styles.apiConfigField}>
              <span>{t('apiBaseUrl')}</span>
              <input
                type="url"
                disabled={form.verifying}
                placeholder={t('apiBaseUrlPlaceholder')}
                value={form.baseUrl}
                onChange={(event) => form.setBaseUrl(event.target.value)}
                autoComplete="url"
                spellCheck={false}
              />
            </label>
            <label className={styles.apiConfigField}>
              <span>{t('apiModel')}</span>
              <input
                type="text"
                disabled={form.verifying}
                placeholder={t('apiModelPlaceholder')}
                value={form.model}
                onChange={(event) => form.setModel(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className={styles.apiConfigField}>
              <label htmlFor={apiKeyId}>API Key</label>
              <div className={styles.apiKeyInput}>
                <input
                  id={apiKeyId}
                  type="password"
                  disabled={form.verifying}
                  placeholder={t('apiKeyPlaceholder')}
                  autoComplete="off"
                  spellCheck={false}
                  // 移动端打开设置时不弹键盘，点编辑后才聚焦
                  autoFocus={!isMobile || editing}
                  value={form.value}
                  onChange={(event) => form.setValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      void form.submit()
                    }
                  }}
                />
                {!isMobile && form.canSubmit ? (
                  <>
                    <span className={styles.divider} />
                    <button
                      type="button"
                      className={styles.confirm}
                      disabled={form.verifying}
                      // 保持输入框焦点
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void form.submit()}
                    >
                      {form.verifying ? t('apiKeyVerifying') : t('confirm')}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        )}
        {showInput && form.error ? <div className={styles.error}>{form.error}</div> : null}
      </div>
    </div>
  )
}

/** 移动端：输入 API Key 时在选项下方显示整行「确定」 */
export const ApiKeyConfirm = ({ editor: { showInput, form } }: { editor: ApiKeyEditor }) => {
  const t = useTranslate()
  return showInput && form.canSubmit ? (
    <button
      type="button"
      className={styles.mobileConfirm}
      disabled={form.verifying}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void form.submit()}
    >
      {form.verifying ? t('apiKeyVerifying') : t('confirm')}
    </button>
  ) : null
}
