// Offline macOS voices for subtitle dubbing, sampled from `say -v '?'`.
// Languages without a matching voice are absent: dubbing skips them with a
// clear message instead of substituting a wrong-language voice.

export type DubVoice = {
  voice: string;
  locale: string;
};

export const DUB_VOICES: Record<string, DubVoice> = {
  ar: { voice: "Majed", locale: "ar_001" },
  bg: { voice: "Daria", locale: "bg_BG" },
  bn: { voice: "Piya", locale: "bn_IN" },
  ca: { voice: "Montse", locale: "ca_ES" },
  cs: { voice: "Zuzana", locale: "cs_CZ" },
  da: { voice: "Sara", locale: "da_DK" },
  de: { voice: "Anna", locale: "de_DE" },
  el: { voice: "Melina", locale: "el_GR" },
  en: { voice: "Samantha", locale: "en_US" },
  es: { voice: "Mónica", locale: "es_ES" },
  fi: { voice: "Satu", locale: "fi_FI" },
  fr: { voice: "Thomas", locale: "fr_FR" },
  he: { voice: "Carmit", locale: "he_IL" },
  hi: { voice: "Lekha", locale: "hi_IN" },
  hr: { voice: "Lana", locale: "hr_HR" },
  hu: { voice: "Tünde", locale: "hu_HU" },
  id: { voice: "Damayanti", locale: "id_ID" },
  it: { voice: "Alice", locale: "it_IT" },
  ja: { voice: "Kyoko", locale: "ja_JP" },
  kn: { voice: "Soumya", locale: "kn_IN" },
  ko: { voice: "Yuna", locale: "ko_KR" },
  ms: { voice: "Amira", locale: "ms_MY" },
  nl: { voice: "Xander", locale: "nl_NL" },
  no: { voice: "Nora", locale: "nb_NO" },
  pl: { voice: "Zosia", locale: "pl_PL" },
  pt: { voice: "Luciana", locale: "pt_BR" },
  ro: { voice: "Ioana", locale: "ro_RO" },
  ru: { voice: "Milena", locale: "ru_RU" },
  sk: { voice: "Laura", locale: "sk_SK" },
  sl: { voice: "Tina", locale: "sl_SI" },
  sv: { voice: "Alva", locale: "sv_SE" },
  ta: { voice: "Vani", locale: "ta_IN" },
  te: { voice: "Geeta", locale: "te_IN" },
  th: { voice: "Kanya", locale: "th_TH" },
  tr: { voice: "Yelda", locale: "tr_TR" },
  uk: { voice: "Lesya", locale: "uk_UA" },
  vi: { voice: "Linh", locale: "vi_VN" },
  zh: { voice: "Tingting", locale: "zh_CN" },
};

export function voiceForLanguage(code: string): DubVoice | null {
  return DUB_VOICES[code.toLowerCase()] ?? null;
}
