import { useState } from 'react'
import { ApiError, verifyApiKey } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import {
  DEFAULT_API_CONFIG,
  setApiConfig,
  type ApiConfig,
  type ApiProvider,
} from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'

/** DeepSeek 用 GET /models 校验；其他兼容接口保存配置，在实际请求时校验。 */
export const useApiKeyForm = (initial: ApiConfig, onSaved?: () => void) => {
  const t = useTranslate()
  const [value, setValue] = useState('')
  const [provider, setProvider] = useState<ApiProvider>(initial.provider)
  const [baseUrl, setBaseUrl] = useState(initial.apiBaseUrl)
  const [model, setModel] = useState(initial.model)
  const [verifying, setVerifying] = useState(false)
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null)
  const cause = failure?.cause
  const error =
    failure === null
      ? null
      : classifyApiError(cause) === 'unauthorized'
        ? t('apiKeyInvalid')
        : classifyApiError(cause) === 'network'
          ? t('commonNetworkErrorToast')
          : t('apiKeyVerificationFailed', {
              message:
                cause instanceof ApiError && cause.localMessage
                  ? t(cause.localMessage.key, cause.localMessage.params)
                  : cause instanceof Error
                    ? cause.message
                    : String(cause),
            })

  const submit = async () => {
    const apiKey = value.trim() || (provider === initial.provider ? (initial.apiKey ?? '') : '')
    if (!apiKey || verifying) {
      return
    }
    setVerifying(true)
    setFailure(null)
    try {
      const config: ApiConfig = {
        provider,
        apiBaseUrl: baseUrl.trim(),
        apiKey,
        model: model.trim(),
      }
      if (!config.apiBaseUrl || !config.model) {
        throw new Error(t('apiConfigRequired'))
      }
      const parsedBaseUrl = new URL(config.apiBaseUrl)
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsedBaseUrl.hostname)
      if (
        (parsedBaseUrl.protocol !== 'https:' &&
          !(parsedBaseUrl.protocol === 'http:' && loopback)) ||
        parsedBaseUrl.username ||
        parsedBaseUrl.password ||
        parsedBaseUrl.search ||
        parsedBaseUrl.hash
      ) {
        throw new Error(t('apiBaseUrlInvalid'))
      }
      config.apiBaseUrl = parsedBaseUrl.href.replace(/\/+$/, '')
      await verifyApiKey(config)
      setApiConfig(config)
      setValue('')
      onSaved?.()
    } catch (e) {
      setFailure({ cause: e })
    } finally {
      setVerifying(false)
    }
  }

  const selectProvider = (next: ApiProvider) => {
    setProvider(next)
    const defaults = DEFAULT_API_CONFIG[next]
    setBaseUrl(defaults.apiBaseUrl)
    setModel(defaults.model)
    setValue('')
    setFailure(null)
  }

  return {
    value,
    setValue,
    provider,
    setProvider: selectProvider,
    baseUrl,
    setBaseUrl,
    model,
    setModel,
    verifying,
    error,
    canSubmit: Boolean(value.trim() || (provider === initial.provider && initial.apiKey)),
    submit,
  }
}
