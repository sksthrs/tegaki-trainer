document.addEventListener('DOMContentLoaded', (ev) => {

  // ========== ========== ログ ========== ==========

  const logArray: string[] = [];

  function logWrite(text: string): void {
    logArray.push(text);
    console.log(text);
  }

  function openLog(): void {
    logText.textContent = logArray.join('\n');
    logDialog.showModal();
  }

  // PWAとしての登録処理
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
    .then((registration) => {
      logWrite(`[Main] ServiceWorker registration finished. Scope:${registration.scope}`);
    })
    .catch((reason) => {
      logWrite(`[Main] ServiceWorker registratio failed. Reason:${reason}`);
    });
  }

  if (navigator.language != null && navigator.language.length > 0) {
    document.documentElement.lang = navigator.language;
  }

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

  const logOpenButton = document.getElementById('log-open') as HTMLButtonElement;

  const logCloseButton = document.getElementById('log-close') as HTMLButtonElement;

  const logDialog = document.getElementById('log-dialog') as HTMLDialogElement;

  const logText = document.getElementById('log-text') as HTMLDivElement;

  // ========== ========== 音声合成 ========== ==========

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
    logWrite(`Enumerate voices... ${voicesAll?.length ?? "null"} SS:${SS != null}`);
    if (voicesAll == null || voicesAll?.length < 1) {
      return;
    }

    const ixCurrent = voiceSelect.selectedIndex < 0 
      ? 0 
      : voiceSelect.selectedIndex;
    clearVoices()
    voices = [];

    for (const voice of voicesAll) {
      logWrite(`voice name:[${voice.name}] lang:[${voice.lang}->${voice.lang.toLowerCase()}] localService:[${voice.localService}] default:${voice.default}`);
      if (voice.lang.includes('ja') !== true) continue;

      voices.push(voice);
      const opt = document.createElement('option');
      const name = voice.name + (voice.localService ? "" : SUFFIX_ONLINE);
      opt.textContent = name;
      voiceSelect.appendChild(opt);
      logWrite(`[addvoice] ${name}`);
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
      stopAllSounds();

      const [phraseToShow, phraseToPronounce, phraseOriginal] = getNextQuestion();
      const tokens1 = divideToken([{text: phraseToShow, isAbbr: false, encircle: false}]);
      const tokens2 = divideNormalTokens(tokens1);

      // phraseTokens を空にする
      while(phraseTokens.pop() != null) {}
      // phraseTokens に求めたトークン配列を設定する
      phraseTokens.push(...tokens2);

      logWrite(`[nextButton.click] next phrase=${phraseOriginal} (show:${phraseToShow} , pronounce:${phraseToPronounce})`);
      speak(phraseToPronounce);
    });

    logOpenButton.addEventListener('click', _ => {
      openLog();
    });

    logCloseButton.addEventListener('click', _ => {
      logDialog.close();
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
    logWrite(`[onSpeakStart] displayText=${displayText} delay=${periodMsec}`);
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

    // カウントダウン中のサウンドを再生
    playCounting();
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

      // カウントダウン完了サウンドを流す
      playUp();
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
    logWrite(`saved config : ${JSON.stringify(config)}`);
  }

  /** 設定を取得する */
  function loadConfig(): Config {
    try {
      const text = localStorage.getItem(STORAGE_KEY);
      if (text != null) {
        const obj = JSON.parse(text);
        logWrite(`[loadConfig] loaded config=${JSON.stringify(obj)}`)
        const config = getConfigDefault();
        if (obj?.voice != null && typeof obj?.voice === 'string') {
          config.voice = obj.voice;
        }
        logWrite(`config loaded : ${JSON.stringify(config)}`);
        return config;
      }
    } catch(err) {
      logWrite(`error in config-load : ${err}`);
    }
    logWrite('no config');
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

  // ========== ========== サウンド処理 ========== ==========

  /** ツール内で使うサウンド一覧 */
  const _SOUNDS = {
    /** カウントダウン中のサウンド */
    counting: new Audio('./sounds/counting.mp3'),
    /** カウントダウン完了時サウンド */
    up: new Audio('./sounds/up.mp3'),
  };
  /** サウンド音量（とりあえず固定値） */
  const _SOUND_VOLUME = 10; // [%]

  /** サウンド初期化 */
  function initializeSounds(): void {
    // 音量初期化
    for (const sound of Object.values(_SOUNDS)) {
      sound.load();
      sound.volume = Math.max(1.0, Math.min(0.0, _SOUND_VOLUME / 100));
    }

    // カウントダウン中のサウンドはループさせる（微妙に
    _SOUNDS.counting.loop = true;
  }

  /** カウントダウン中サウンドの再生を開始する */
  function playCounting(): void {
    _SOUNDS.counting.currentTime = 0;
    _SOUNDS.counting.play();
  }

  /** カウントダウン中サウンドの再生を停止する */
  function stopPlayCounting(): void {
    _SOUNDS.counting.pause();
  }

  /** カウントダウン完了時サウンドの再生を開始する */
  function playUp(): void {
    stopPlayCounting();
    _SOUNDS.up.currentTime = 0;
    _SOUNDS.up.play();
  }

  /** カウントダウン完了時サウンドの再生を停止する */
  function stopPlayUp(): void {
    _SOUNDS.up.pause();
  }

  /** 全てのサウンドを停止する */
  function stopAllSounds(): void {
    for (const sound of Object.values(_SOUNDS)) {
      sound.pause();
    }
  }

  // ========== ========== 初期処理 ========== ==========

  // サウンド初期化
  initializeSounds();

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

  /** ルビ抽出用の正規表現 */
  const RE_RUBY = /｜([^《]+)《([^》]+)》/g;

  /**
   * 次の問題の表示用文字列と発音用文字列と元文字列を取得する。
   * 日本語は同音異義語が多いため、問題文にルビを指定できるようにしている。
   * 形式はカクヨムのものを基準にさらに限定して、"｜表示文字列《よみがな》" とした。
   * @returns 表示用文字列、発音用文字列、元文字列のタプル
   */
  function getNextQuestion(): [string, string, string] {
    if (questionIds.length < 1) {
      fillQuestionIdsRandomly();
    }
    const nextId = questionIds.shift();
    const nextPhrase = phrases.at(nextId ?? -1);
    if (nextPhrase == null) {
      throw new Error('(impossible case) questionId is null!');
    }

    // 読み仮名チェック
    const matches = [...nextPhrase.matchAll(RE_RUBY)];

    // 読み仮名表記を含まない場合は元の文字列が表記用かつ発音用になる
    if (matches.length < 1) {
      return [nextPhrase, nextPhrase, nextPhrase];
    }

    // 読み仮名表記を含む場合はそれぞれを構築する
    let phraseToShow = '';
    let phraseToPronounce = '';
    let ixStart = 0;
    try {
      for (const match of matches) {
        if (match.length !== 3) throw new Error(`エラー："${nextPhrase}"のindex${match.index}のmatchの長さが3ではなく${match.length}`);
        const preMatch = nextPhrase.substring(ixStart, match.index);
        phraseToShow += preMatch + match[1];
        phraseToPronounce += preMatch + match[2];
        ixStart = match.index + match[0].length;
      }
      const post = nextPhrase.substring(ixStart);
      phraseToShow += post;
      phraseToPronounce += post;
    } catch(err) {
      return [(err as Error)?.message ?? nextPhrase, "エラーです", nextPhrase];
    }

    return [phraseToShow, phraseToPronounce, nextPhrase];
  }

  function fillQuestionIdsRandomly(): void {
    if (questionIds.length > 0) return;

    const idSeq = generateArithmeticSequence(0, phrases.length);
    const idShuffled = shuffleArray(idSeq);
    logWrite(`[fillQuestionIdsWithRandom] shuffled=${JSON.stringify(idShuffled)}`);
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
    { source: "FAX", abbr: "Ｆ", encircle: true, },
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
    {source: "健聴者", replace: "けんちょうしゃ"},
    {source: "健聴", replace: "けんちょう"},
  ];

  // ========== ========== 出題フレーズそのもの ========== ==========

  const phrases = [
    "難聴者には正面から話しかける。",
    "聴覚障害の原因はさまざま。",
    "連絡先にはFAXも明記する。",
    "聴覚障害はコミュニケーション障害です。",
    "講演会に手話通訳と要約筆記をつける。",
    "健聴者への啓発が必要だ。",
    "右耳に補聴器をつけている。",
    "市役所の福祉課で相談する。",
    "「ろうあ」は以前、欠格条項だった。",
    "私は中途失聴者です。",
    "中途失聴とは、難聴者運動でできた言葉。",
    "ろうあ者というアイデンティティー。",
    "昨日はボランティア集会に参加した。",
    "このホールにはヒアリングループがある。",
    "中途失聴者は以前は健聴者だった。",
    "伝音難聴には補聴器が有効。",
    "難聴者協会の会員の多くは感音難聴だ。",
    "聴覚障害者向けの福祉制度は少ない。",
    "要約筆記者の養成は県の事業だ。",
    "補聴器はフィッティングが大事。",
    "補聴器と人工内耳の違いは何か。",
    "人工内耳をしても、障害者手帳の等級は変わらない。",
    "補聴器も人工内耳も、お手入れは大事。",
    "福祉でいう聴覚障害者用 通信装置は、FAXのこと。",
    "ろうあ者で１級の障害者手帳を持つ人がいる。",
    "補聴器をFAXで注文する。",
    "ろうあは、聴覚と言語の二重障害だとされる。",
    "タイループとは、個人用のヒアリングループ。",
    "ボランティアとは、自発的という意味。",
    "認定補聴器専門店で補聴器を買う。",
    "要約筆記の体験講座があります。",
    "手書き要約筆記者は対人支援の要です。",
    "パソコン要約筆記には、いすと机が必要。",
    "今日の手話教室は福祉センターで行う。",
    "要約筆記はコミュニケーション支援です。",
    "福祉の対象は障害者だけではない。",
    "ろうあ者同士はコミュニケーションに困らない。",
    "手話は大事なコミュニケーション手段。",
    "手話サークルで、ろうあ者と出会う。",
    "難聴者からFAXが届いた。",
    "コミュニケーションが不足している。",
    "難聴は「ほほえみの障害」ともいわれる。",
    "福祉関係のボランティアに応募する。",
    "若い聴覚障害者の多くは、もうFAXを持っていない。",
    "中途失聴なので手話は分かりません。",
    "難聴者向けの手話教室は木曜日です。",
    "聴覚障害者支援センターは津市にある。",
    "テレビの手話講座を見る。",
    "「週刊手話ニュース」をご存じですか？",
    "ろうあ連盟が手話の辞典を出した。",
    "今年の全難聴の大会は、京都である。",
    "全難聴の「難聴者の｜明日《あす》」は｜年《ねん》４回の発行。",
    "難聴者向けの読話教室がほしい。",
    "要約筆記者の派遣は市町村の必須事業。",
    "耳マークを福祉課に置いてほしい。",
    "全難聴も、字幕放送を要望してきた。",
    "手話と字幕の番組「目で聴くテレビ」をご存じ？",
    "アイドラゴンは、聴覚障害者用 情報受信装置だ。",
    "2025年度に「手話リンク」の提供が始まった。",
    "障害者手帳がなくても電話リレーサービスは使える。",
    "ヨメテルは、発話ができる聴覚障害者が対象。",
    "中途失聴者や難聴者にも手話を使う人はいる。",
    "昔、字幕放送デコーダーを福祉でもらった。",
    "津波フラッグは、聴覚障害者にも分かりやすい。",
  ] as const;
});