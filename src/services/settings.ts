import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

export type ApiProvider = 'deepseek' | 'aliyun' | 'openai' | 'custom'

export type ApiConfig = {
  provider: ApiProvider
  apiBaseUrl: string
  apiKey: string | null
  model: string
}

export const DEFAULT_API_CONFIG: Record<ApiProvider, Omit<ApiConfig, 'apiKey'>> = {
  deepseek: {
    provider: 'deepseek',
    apiBaseUrl: `${__API_ORIGIN__.replace(/\/+$/, '')}/anthropic`,
    model: 'deepseek-flash',
  },
  aliyun: {
    provider: 'aliyun',
    apiBaseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
    model: 'qwen3.8-max',
  },
  openai: {
    provider: 'openai',
    apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  custom: {
    provider: 'custom',
    apiBaseUrl: '',
    model: '',
  },
}

/** 本机设置，存 localStorage：API 配置、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiProvider: ApiProvider
  apiBaseUrl: string
  apiKey: string | null
  apiModel: string
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  apiProvider: 'chat-demo:api-provider',
  apiBaseUrl: 'chat-demo:api-base-url',
  apiKey: 'chat-demo:api-key',
  apiModel: 'chat-demo:api-model',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

const initialApiProvider = (): ApiProvider => {
  const saved = read(KEYS.apiProvider)
  return saved === 'aliyun' || saved === 'openai' || saved === 'custom' ? saved : 'deepseek'
}

const initialApiConfig = () => {
  const provider = initialApiProvider()
  const defaults = DEFAULT_API_CONFIG[provider]
  return {
    provider,
    apiBaseUrl: read(KEYS.apiBaseUrl) || defaults.apiBaseUrl,
    apiKey: read(KEYS.apiKey),
    apiModel: read(KEYS.apiModel) || defaults.model,
  }
}

export const isDeepSeekProvider = (provider: ApiProvider) => provider === 'deepseek'

export const isAnthropicProvider = (provider: ApiProvider) =>
  provider === 'deepseek' || provider === 'aliyun' || provider === 'custom'

export const getApiConfig = (): ApiConfig => {
  const state = useSettings.getState()
  return {
    provider: state.apiProvider,
    apiBaseUrl: state.apiBaseUrl,
    apiKey: state.apiKey,
    model: state.apiModel,
  }
}

const initialApi = initialApiConfig()

export const useSettings = create<Settings>(() => ({
  apiProvider: initialApi.provider,
  apiBaseUrl: initialApi.apiBaseUrl,
  apiKey: initialApi.apiKey,
  apiModel: initialApi.apiModel,
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiConfig = (config: ApiConfig) => {
  write(KEYS.apiProvider, config.provider)
  write(KEYS.apiBaseUrl, config.apiBaseUrl)
  write(KEYS.apiKey, config.apiKey)
  write(KEYS.apiModel, config.model)
  useSettings.setState({
    apiProvider: config.provider,
    apiBaseUrl: config.apiBaseUrl,
    apiKey: config.apiKey,
    apiModel: config.model,
  })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
