import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en'
import zh from './locales/zh-Hans'

export const LANGS = ['zh-Hans', 'en'] as const
export type Lang = (typeof LANGS)[number]

const STORAGE_KEY = 'whereisit.lang'

function detectLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'zh-Hans' || stored === 'en') return stored
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-Hans' : 'en'
}

i18n.use(initReactI18next).init({
  resources: {
    'zh-Hans': { translation: zh },
    en: { translation: en },
  },
  lng: detectLang(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export function setLang(lang: Lang): void {
  void i18n.changeLanguage(lang)
  localStorage.setItem(STORAGE_KEY, lang)
}

export function isZh(): boolean {
  return i18n.language.startsWith('zh')
}

export default i18n
