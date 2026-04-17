// PWAとしての登録処理
// if ('serviceWorker' in navigator) {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('sw.js')
//     .then((registration) => {
//       console.log(`[Main] ServiceWorker registration finished. Scope:${registration.scope}`);
//     })
//     .catch((reason) => {
//       console.log(`[Main] ServiceWorker registratio failed. Reason:${reason}`);
//     });
//   });
// }

if (navigator.language != null && navigator.language.length > 0) {
  document.documentElement.lang = navigator.language;
}

document.addEventListener('DOMContentLoaded', (ev) => {

  /** 設定値を保存する際のキー文字列 */
  const STORAGE_KEY = "TegakiTrainer"

  // ========== ========== 音声合成 ========== ==========

  /** 日本語と判定できる言語タグを小文字にしたもの */
  const JP_LANGS = ['ja', 'ja-jp'];

  /** ネット接続が必要な音声につける説明文字列 */
  const SUFFIX_ONLINE = " (要ネット接続)";

  /** 音声合成インタフェース */
  const SS = window.speechSynthesis
  
  /** @type {HTMLSelectElement} */
  const voiceSelect = document.getElementById('voices');

  /** @type {SpeechSynthesisVoice[]} */
  let voices = []

  /** 音声一覧を示すselect要素を空にする */
  function clearVoices() {
    voices = []
    for (const opt of voiceSelect.options) {
      opt.remove()
    }
  }

  /** ブラウザで使える、日本語・ローカル処理可能な音声をselect要素に詰める */
  function populateVoices() {
    const voicesAll = SS.getVoices();
    console.log(`Enumerate voices... ${voicesAll?.length ?? "null"} SS:${SS != null}`);
    if (voicesAll == null || voicesAll?.length < 1) {
      return;
    }

    const ixCurrent = voiceSelect.selectedIndex < 0 
      ? 0 
      : voiceSelect.selectedIndex;
    clearVoices()

    for (const voice of voicesAll) {
      console.log(`voice name:[${voice.name}] lang:[${voice.lang}] localService:[${voice.localService}] default:${voice.default}`);
      if (JP_LANGS.includes(voice.lang.toLowerCase()) !== true) continue;

      const opt = document.createElement('option');
      const name = voice.name + (voice.localService ? "" : SUFFIX_ONLINE);
      opt.textContent = name;
      voiceSelect.appendChild(opt);
      console.log(`[addvoice] ${name}`);
    }

    voiceSelect.selectedIndex = ixCurrent;
    selectOptionByText(appConfig.voice ?? "");
  }

  /**
   * 音声に対応するoption要素の文字列から、本来の音声名称を取得する
   * （option要素の文字列には、オンライン処理が必要な音声は末尾に説明がついているため）
   * @param {string} option要素の文字列（textContent）
   */
  function getVoiceNameFromOptionText(optionText) {
    if (optionText.endsWith(SUFFIX_ONLINE)) {
      return optionText.substring(0, optionText.length - SUFFIX_ONLINE.length);
    } else {
      return optionText;
    }
  }

  // ========== ========== 本件特有の関数いろいろ ========== ==========

  function setEventHandlers() {
  }

  // ========== ========== 設定関連 ========== ==========

  /** @type {Config} */
  let appConfig = loadConfig();
  applyConfig(appConfig);

  /**
   * @typedef Config
   * @property {string | undefined} voice voice model for speech
   */

  /**
   * デフォルト設定を生成する
   * @returns {Config} デフォルト設定オブジェクト
   */
  function getConfigDefault() {
    return {
      voice: "",
    };
  }

  /**
   * 設定を保存する
   * @param {Config} config 保存する設定
   */
  function saveConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    console.log(`saved config : ${JSON.stringify(config)}`);
  }

  /**
   * 設定を取得する
   * @returns {Config} 設定（保存されてない場合はデフォルト値）
   */
  function loadConfig() {
    try {
      const text = localStorage.getItem(STORAGE_KEY);
      if (text != null) {
        const obj = JSON.parse(text);
        console.log(`[loadConfig] loaded config=${JSON.stringify(obj)}`)
        /** @type {Config} */
        const config = getConfigDefault();
        if (obj?.voice != null && typeof obj?.voice === 'string') {
          config.voice = obj.voice;
        }
        console.log(`config loaded : ${JSON.stringify(config)}`);
        return config;
      }
    } catch(err) {
      console.log(`error in config-load : ${err}`);
    }
    console.log('no config');
    return getConfigDefault();
  }

  /**
   * Apply configuration into this application
   * @param {Config} config 
   */
  function applyConfig(config) {
    if (config == null) return

    if (config?.voice != null && typeof config?.voice === 'string') {
    }
  }

  // ========== ========== 汎用的な関数 ========== ==========

  /**
   * select要素の項目から引数と一致するものを選択状態にする。
   * 引数と一致するものがない場合は何もしない。
   * @param {HTMLSelectElement} element 対象となるselect要素
   * @param {string} text 選択する項目の文字列
   * @returns {number} 選択された項目のインデックス、もしくは-1（一致する項目がなかった場合）
   */
  function selectOptionByText(element, text) {
    if (element.options == null || element.options.length < 1) return -1;
    Array.from(element.options).forEach((option, index) => {
      if (getVoiceNameFromOptionText(option.textContent) === text) {
        option.selected = true;
        // element.selectedIndex = index;
        return index;
      }
    });
    return -1;
  }

  // ========== ========== 初期処理 ========== ==========

  setEventHandlers();

  populateVoices();
  if (SS.onvoiceschanged !== undefined) {
    SS.addEventListener('voiceschanged', _ev => {
      populateVoices();
    });
  }

  // ========== ========== 出題フレーズ関連処理 ========== ==========

  /** @type {Map<string, {abbr:string, encircle:boolean}>} */
  const abbreviationDictionary = new Map([
    ["難聴", { abbr: "ナ", encircle: true, }],
    ["障害", { abbr: "シ", encircle: true, }],
    ["コミュニケーション", { abbr: "コミ", encircle: false, }],
    ["FAX", { abbr: "F", encircle: true, }],
    ["要約筆記", { abbr: "ヨ", encircle: true, }],
  ]);

  // ========== ========== 出題フレーズそのもの ========== ==========

  const phrasess = [
    "難聴者には正面から話してください。",
    "聴覚障害の原因は必ずしも明らかではありません。",
    "連絡先にはFAXも明記しましょう。",
    "聴覚障害はコミュニケーション障害です。",
    "講演会に要約筆記がついた",
  ];
});