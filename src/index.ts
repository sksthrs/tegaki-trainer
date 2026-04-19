// PWAとしての登録処理
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
    .then((registration) => {
      console.log(`[Main] ServiceWorker registration finished. Scope:${registration.scope}`);
    })
    .catch((reason) => {
      console.log(`[Main] ServiceWorker registratio failed. Reason:${reason}`);
    });
  });
}

if (navigator.language != null && navigator.language.length > 0) {
  document.documentElement.lang = navigator.language;
}

// アプリケーション
document.addEventListener('DOMContentLoaded', (ev) => {

  /** 設定値を保存する際のキー文字列 */
  const STORAGE_KEY = "TegakiTrainer"

  /** 次ボタン */
  const nextButton = document.getElementById('next') as HTMLButtonElement;

  /** 表記表示領域 */
  const answerDisplay = document.getElementById('answer') as HTMLDivElement;

  /** 表記表示を待機するためのタイマー（正の値の場合のみ有効） */
  let timerId = -1;

  const phraseTokens: PhraseToken[] = [];

  let animation: Animation | undefined = undefined;

  // ========== ========== 音声合成 ========== ==========

  /** 日本語と判定できる言語タグを小文字にしたもの */
  const JP_LANGS = ['ja', 'ja-jp'];

  /** ネット接続が必要な音声につける説明文字列 */
  const SUFFIX_ONLINE = " (要ネット接続)";

  /** 音声合成インタフェース */
  const SS = window.speechSynthesis
  
  const voiceSelect = document.getElementById('voices') as HTMLSelectElement;

  /** ブラウザで利用できる日本語音声 */
  let voices:SpeechSynthesisVoice[] = [];

  /** 選択された音声 */
  let voiceCurrent:SpeechSynthesisVoice | undefined = undefined;

  /** 音声一覧を示すselect要素を空にする */
  function clearVoices(): void {
    voices = []
    for (const opt of voiceSelect.options) {
      opt.remove()
    }
  }

  /** ブラウザで使える、日本語・ローカル処理可能な音声をselect要素に詰める */
  function populateVoices(): void {
    const voicesAll = SS.getVoices().sort((a,b) => a.name.localeCompare(b.name));
    console.log(`Enumerate voices... ${voicesAll?.length ?? "null"} SS:${SS != null}`);
    if (voicesAll == null || voicesAll?.length < 1) {
      return;
    }

    const ixCurrent = voiceSelect.selectedIndex < 0 
      ? 0 
      : voiceSelect.selectedIndex;
    clearVoices()
    voices = [];

    for (const voice of voicesAll) {
      // console.log(`voice name:[${voice.name}] lang:[${voice.lang}] localService:[${voice.localService}] default:${voice.default}`);
      if (JP_LANGS.includes(voice.lang.toLowerCase()) !== true) continue;

      voices.push(voice);
      const opt = document.createElement('option');
      const name = voice.name + (voice.localService ? "" : SUFFIX_ONLINE);
      opt.textContent = name;
      voiceSelect.appendChild(opt);
      console.log(`[addvoice] ${name}`);
    }

    voiceSelect.selectedIndex = ixCurrent;
    voiceCurrent = voices[ixCurrent];
    selectOptionByText(voiceSelect, appConfig.voice ?? "");
  }

  /**
   * 音声に対応するoption要素の文字列から、本来の音声名称を取得する
   * （option要素の文字列には、オンライン処理が必要な音声は末尾に説明がついているため）
   */
  function getVoiceNameFromOptionText(optionText: string): string {
    if (optionText.endsWith(SUFFIX_ONLINE)) {
      return optionText.substring(0, optionText.length - SUFFIX_ONLINE.length);
    } else {
      return optionText;
    }
  }

  /**
   * 引数で指定した文字列を読み上げる
   * @param {string} phrase 読み上げる文字列
   */
  function speak(phrase: string): void {
    cancelTimer();

    let phrase2 = phrase.endsWith('。') ? phrase.substring(0, phrase.length-1) : phrase;
    for (const speechDictItem of speechDictionary) {
      phrase2 = phrase2.replaceAll(speechDictItem.source, speechDictItem.replace);
    }
    const utterance = new SpeechSynthesisUtterance(phrase2);
    if (voiceCurrent != null) {
      utterance.voice = voiceCurrent;
    }
    utterance.addEventListener('start', _ev => {
      onSpeakStart();
    });
    utterance.addEventListener('end', _ev => {
      onSpeakEnd();
    });
    utterance.addEventListener('error', ev => {
      answerDisplay.textContent = `音声合成で異常が発生しました。音声を切り替えるか、Chromeなど他のブラウザでご利用ください。（エラーコード : ${ev.error}/${ev.name}）`;
      onSpeakEnd();
      cancelTimer();
    });
    onSpeakPrepare();
    SS.speak(utterance);
  }

  // ========== ========== 本件特有の関数いろいろ ========== ==========

  function setEventHandlers(): void {
    voiceSelect.addEventListener('input', ev => {
      const ix = voiceSelect.selectedIndex;
      if (0 <= ix && ix < voices.length) {
        voiceCurrent = voices[ix];
        if (voiceCurrent?.name != null) {
          appConfig.voice = voiceCurrent.name;
          saveConfig(appConfig);
        }
      }
    });

    nextButton.addEventListener('click', _ev => {
      const phrase = getNextQuestion();
      const tokens1 = divideToken([{text: phrase, isAbbr: false, encircle: false}]);
      const tokens2 = divideNormalTokens(tokens1);

      // phraseTokens を空にする
      while(phraseTokens.pop() != null) {}
      // phraseTokens に求めたトークン配列を設定する
      phraseTokens.push(...tokens2);

      console.log(`[nextButton.click] next phrase=${phrase}`);
      speak(phrase);
    });
  }

  /** 音声合成の準備開始時点での処理 */
  function onSpeakPrepare(): void {
    // 見た目を変化させ、ボタンは二度押しを禁止する
    nextButton.disabled = true;
    setTextToAnswer('（音声合成 準備中）');
  }

  /** 発声開始時点での処理 */
  function onSpeakStart(): void {
    // 見た目を変化させる
    // setTextToAnswer('（発声中）');

    // 書く長さにあわせた時間経過後に表記例を表示する
    const displayText = phraseTokens.map(token => token.text).join('');
    const elements = makeDisplayElements(phraseTokens);
    const periodMsec = displayText.length * 750; // 0.75文字/秒（80文字/分）を想定。短いが言い終わってからなのでまあそんなもの。
    console.log(`[onSpeakStart] displayText=${displayText} delay=${periodMsec}`);
    timerId = setTimeout(
      () => {
        setSpansToAnswer(elements);
        timerId = -1;
      }, 
      periodMsec
    );
    makeCountdownAnimation(periodMsec);
  }

  /** 発声終了時点での処理 */
  function onSpeakEnd(): void {
    // 見た目を変化させる。また次ボタンは操作可能とする。
    nextButton.disabled = false;
  }

  function makeCountdownAnimation(periodMsec: number): void {
    // span要素を作成して表記例領域に追加
    const el = document.createElement('span');
    el.classList.add('countdown');
    setSpansToAnswer([el]);
    // 縮むアニメーションを開始
    animation = el.animate(
      [
        {width: '100%', backgroundColor: '#80ff80'},
        {width: '30%', backgroundColor: '#80ff80', offset: 0.7},
        {width: '15%', backgroundColor: '#f0f080', offset: 0.85},
        {width: '0%', backgroundColor: '#ff8080'},
      ],
      periodMsec - 10 // 指定よりわずかに早く終了させる（指定時間に別のDOM操作が入るので）
    );
    // アニメーションが終了したら要素ごと削除
    animation.addEventListener('finish', _ev => {
      el.remove();
      animation = undefined;
    });
  }

  function cancelTimer() {
    if (timerId > 0) {
      clearTimeout(timerId);
      timerId = -1;
    }
    if (animation != null) {
      animation.finish();
      setTimeout(() => {
        animation = undefined;
      }, 0);
    }
  }

  /** 表記例の領域の中身を全て消す */
  function clearAnswer(): void {
    for (let ix = answerDisplay.children.length-1; ix >= 0; ix--) {
      answerDisplay.children.item(ix)?.remove();
    }
  }

  /** 表記例の領域に、span要素の配列を設定する（それまでの内容は消える） */
  function setSpansToAnswer(elements: HTMLElement[]): void {
    clearAnswer();
    for (const element of elements) {
      answerDisplay.append(element);
    }
  }

  /** 表記例の領域に文字列を設定する（それまでの内容は消える） */
  function setTextToAnswer(text: string): void {
    clearAnswer();
    const span = document.createElement('span');
    span.textContent = text;
    answerDisplay.append(span);
  }

  // ========== ========== 設定関連 ========== ==========

  /** アプリケーション設定 */
  type Config = {
    voice?: string,
  };

  let appConfig: Config = loadConfig();
  applyConfig(appConfig);

  /** デフォルト設定を生成する */
  function getConfigDefault(): Config {
    return {
      voice: "",
    };
  }

  /** 設定を保存する */
  function saveConfig(config: Config): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    console.log(`saved config : ${JSON.stringify(config)}`);
  }

  /** 設定を取得する */
  function loadConfig(): Config {
    try {
      const text = localStorage.getItem(STORAGE_KEY);
      if (text != null) {
        const obj = JSON.parse(text);
        console.log(`[loadConfig] loaded config=${JSON.stringify(obj)}`)
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

  /** 設定を適用する */
  function applyConfig(config: Config): void {
    if (config == null) return
    // 設定には音声の選択だけがあり、これは音声一覧の更新時に反映されるため、ここでの処理はなし。
  }

  // ========== ========== 汎用的な関数 ========== ==========

  /**
   * select要素の項目から引数と一致するものを選択状態にする。
   * 引数と一致するものがない場合は何もしない。
   * @param {HTMLSelectElement} element 対象となるselect要素
   * @param {string} text 選択する項目の文字列
   * @returns {number} 選択された項目のインデックス、もしくは-1（一致する項目がなかった場合）
   */
  function selectOptionByText(element: HTMLSelectElement, text: string): number {
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

  /**
   * 配列をシャッフルしたものを返す
   * @param array シャッフルする対象となる配列
   * @return シャッフルされた配列
   */
  function shuffleArray<T>(array: T[]): T[] {
    const result = [...array];
    const len = result.length
    for (let i = len-1 ; i > 0 ; i--) {
      const j = Math.floor(Math.random()*(i + 1));
      // @ts-expect-error
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * 等差数列の配列を作成する
   * @param start 開始値
   * @param count 数列の長さ
   * @param delta [option] 増分
   * @returns 数列の配列
   */
  function generateArithmeticSequence(start: number, count: number, delta: number = 1): number[] {
    return [...Array(count)].map((_,ix) => ix*delta + start);
  }

  // ========== ========== 初期処理 ========== ==========

  // 音声一覧取得以外のイベントハンドラを設定
  setEventHandlers();

  // 起動時点で音声が取得できるなら、とりあえずそれを設定する
  populateVoices();
  // 音声一覧が後から更新される場合でも反映できるように（通常はこれ）イベントハンドラを設定
  if (SS.onvoiceschanged !== undefined) {
    SS.addEventListener('voiceschanged', _ev => {
      populateVoices();
    });
  }

  // ========== ========== 出題フレーズ関連処理 ========== ==========

  /**
   * 項目のインデックスを出題順に並べたもの。
   * 出題のたびに先頭から抜き出すので配列の項目数は変動する。
   */
  const questionIds: number[] = [];

  /**
   * 次の問題を取得する。
   */
  function getNextQuestion(): string {
    if (questionIds.length < 1) {
      fillQuestionIdsRandomly();
    }
    const nextId = questionIds.shift();
    const nextPhrase = phrases.at(nextId ?? -1);
    if (nextPhrase == null) {
      throw new Error('(impossible case) questionId is null!');
    }
    return nextPhrase;
  }

  function fillQuestionIdsRandomly(): void {
    if (questionIds.length > 0) return;

    const idSeq = generateArithmeticSequence(0, phrases.length);
    const idShuffled = shuffleArray(idSeq);
    console.log(`[fillQuestionIdsWithRandom] shuffled=${JSON.stringify(idShuffled)}`);
    questionIds.push(...idShuffled);
  }

  function makeDisplayElements(tokens: PhraseToken[]): HTMLSpanElement[] {
    const elements = tokens.map(token => {
      const el = document.createElement('span');
      el.textContent = token.text;
      if (token.isAbbr) {
        el.classList.add('abbr');
      }
      if (token.encircle) {
        el.classList.add('encircle');
      }
      return el;
    });
    return elements;
  }

  function divideToken(tokens: PhraseToken[]): PhraseToken[] {
    const result = [...tokens];
    for (const abbrItem of abbreviationArray) {
      while(true) {
        const ixToken = result.findIndex(token => 
          token.isAbbr !== true && token.text.includes(abbrItem.source)
        );
        if (ixToken < 0) break;
        // result[ix] がabbrItem.source を含んでいるので分割
        const divided: PhraseToken[] = [];
        const tokenText = result[ixToken]!.text; // result[ixToken]は絶対ある
        const ixText = tokenText.indexOf(abbrItem.source);
        // 略語略号の手前の文字列が存在するなら追加
        if (ixText > 0) {
          divided.push({text: tokenText.substring(0, ixText), isAbbr: false, encircle: false});
        }
        // 略語略号を追加
        divided.push({text: abbrItem.abbr, isAbbr: true, encircle: abbrItem.encircle});
        // 略語略号の後があれば追加
        if ((ixText + abbrItem.source.length) < tokenText.length) {
          divided.push({text: tokenText.substring(ixText + abbrItem.source.length), isAbbr: false, encircle: false});
        }
        // 配列の置き換え
        result.splice(ixToken, 1, ...divided);
      }
    }
    return result;
  }

  /** 日本語文字列を書記素単位に分割するためのオブジェクト */
  const segmenter = new Intl.Segmenter("ja-JP", { granularity: "grapheme" });

  /**
   * 引数として与えられたトークン配列から、略語略号ではないトークンについて、
   * 書記素（grapheme）単位にトークンを分割し、処理後のトークン配列を返す。
   * （背景）
   * トークンごとにspan要素を作って並べると、略語略号ではないトークンが長すぎて
   * 変なところで折り返されることに対応するための処理
   * @param tokens 処理対象となるトークン配列（この配列は変化しない）
   * @return 処理後のトークン配列
   */
  function divideNormalTokens(tokens: PhraseToken[]): PhraseToken[] {
    const result: PhraseToken[] = [];
    for (const token of tokens) {
      if (token.isAbbr) {
        result.push(token);
      } else {
        Array.from(
          segmenter.segment(token.text)
        ).forEach(grapheme => {
          result.push({
            text: grapheme.segment,
            isAbbr: false,
            encircle: false,
          })
        });
      }
    }
    return result;
  }

  type PhraseToken = {
    text: string,
    isAbbr: boolean,
    encircle: boolean,
  };

  type Abbreviation = {
    source: string,
    abbr: string,
    encircle: boolean,
  };

  const abbreviationArray: Abbreviation[] = [
    { source: "聴覚障害", abbr: "チシ", encircle: true, },
    { source: "健聴", abbr: "ケ", encircle: true, },
    { source: "障害", abbr: "シ", encircle: true, },
    { source: "聴覚", abbr: "チ", encircle: true, },
    { source: "難聴", abbr: "ナ", encircle: true, },
    { source: "福祉", abbr: "フ", encircle: true, },
    { source: "補聴器", abbr: "ホ", encircle: true, },
    { source: "要約筆記", abbr: "ヨ", encircle: true, },
    { source: "ろうあ", abbr: "ろ", encircle: true, },
    { source: "FAX", abbr: "F", encircle: true, },
    { source: "手話", abbr: "手", encircle: true, },
    { source: "コミュニケーション", abbr: "コミ", encircle: false, },
    { source: "中途失聴", abbr: "中失", encircle: false, },
    { source: "ボランティア", abbr: "ボラ", encircle: false, },
    { source: "ヒアリングループ", abbr: "ループ", encircle: false, },
    { source: "磁気誘導ループ", abbr: "ループ", encircle: false, },
  ];

  type SpeechDictionaryItem = {
    source: string,
    replace: string,
  };

  const speechDictionary: SpeechDictionaryItem[] = [
    {source: "失聴者", replace: "しっちょうしゃ"},
    {source: "失聴", replace: "しっちょう"},
  ];

  // ========== ========== 出題フレーズそのもの ========== ==========

  const phrases = [
    "難聴者には正面から話す。",
    "聴覚障害の原因は必ずしも明らかではない。",
    "連絡先にはFAXも明記する。",
    "聴覚障害はコミュニケーション障害です。",
    "講演会に手話と要約筆記をつける。",
    "健聴者への啓発が必要だ。",
    "右耳に補聴器をつけている。",
    "市役所の福祉課で相談する。",
    "ろうあと難聴の違いについて。",
    "私は中途失聴者です。",
    "昨日はボランティア集会に参加した。",
    "このホールにはヒアリングループが設置されている。",
    "中途失聴者も、以前は健聴者だった。",
    "伝音性難聴には補聴器が有効。",
    "難聴者協会の会員の多くは感音難聴である。",
    "聴覚障害者向けの福祉制度は少ない。",
    "要約筆記者の養成は県の事業だ。",
    "補聴器はフィッティングが大事。",
    "ろうあ者で聴覚障害１級を持つ人がいる。",
  ] as const;
});