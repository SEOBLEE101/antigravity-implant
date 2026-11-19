// 읽기 쉬운 답(Readable Replies) 규칙 번역·언어 감지·GEMINI.md 마커 병합/제거 도구 (순수 ESM, Node 내장 모듈만 사용).

export const MARKER_PREFIX = 'antigravity-implant:readable-replies';
export const startMarker = (langTag) => `<!-- ${MARKER_PREFIX}:start lang=${langTag} -->`;
export const END_MARKER = `<!-- ${MARKER_PREFIX}:end -->`;

const START_MARKER_RE = /<!--\s*antigravity-implant:readable-replies:start\s+lang=([^\s>]+)\s*-->/g;
const END_MARKER_RE = /<!--\s*antigravity-implant:readable-replies:end\s*-->/g;
const ANY_START_RE = /<!--\s*antigravity-implant:readable-replies:start\b[^>]*-->/g;
const BCP47_RE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,2}$/;

export const SUPPORTED_LANGS = Object.freeze(['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'pt']);

export const TRANSLATIONS = Object.freeze({
  ko: {
    heading: '## 읽기 쉬운 답',
    items: [
      '결론부터. 첫 문단 한두 문장에 답이나 결과를 쓰고, 설명은 그 뒤에 둔다.',
      '문단 사이는 한 줄 띄운다. 한 문단에는 한 가지 이야기만 담는다.',
      '글머리 하나에 생각 하나. 두 줄이 넘으면 나눈다. 여러 사실을 → / · , 로 이어 붙이지 않는다.',
      '코드 서식(`)은 사용자가 그대로 복사해 입력할 것에만 쓴다: 명령, 코드, 파일 경로, 설정 값, 단축키. 숫자, 이름, 용어, 강조하고 싶은 말에는 쓰지 않는다.',
      '파일은 문장 중간에 넣지 않는다. 문장에서는 "상세 학습 계획 파일"처럼 무엇인지 말로 쓰고, 파일 이름·링크는 그 줄이나 문단 끝에 "파일: 이름1, 이름2"로 한 번에 모은다. 링크는 사용자가 실제로 열어 볼 파일만 걸고, 같은 파일은 다시 적지 않는다.',
      '굵게는 글머리 앞의 짧은 제목이나 꼭 놓치면 안 되는 한 가지에만. 한 문단에 한 번을 넘기지 않는다.',
      '문장으로 쓴다. 괄호 안에 괄호를 또 넣지 않고, [꼬리표], 이모지·아이콘 장식, 화살표 나열을 쓰지 않는다. 순서가 있는 목록은 1. 2. 3. 이나 ①② 를 써도 된다.',
      '내부 약어·작업 코드명은 사용자가 아는 말로 풀어 쓴다.',
      '제목은 긴 답에만, 3개 이하. 표는 여러 항목을 같은 기준으로 비교할 때만 쓴다.',
      '끝은 사용자가 다음에 할 일이나 결정할 것 하나로 맺는다. 같은 내용을 마지막에 다시 요약하지 않는다.',
    ],
  },
  en: {
    heading: '## Readable Replies',
    items: [
      'Start with the conclusion. Put the direct answer or result in the first one or two sentences, and place explanations afterward.',
      'Leave one blank line between paragraphs. Keep one topic per paragraph.',
      'One idea per bullet. Split any bullet over two lines. Do not chain multiple facts with arrows, middle dots, or commas.',
      'Use inline code formatting (`) only for text the user will copy and type literally: commands, code, file paths, config values, and shortcuts. Do not use it for numbers, names, terms, or emphasis.',
      'Do not put file names mid-sentence. Refer to them descriptively in prose (such as "the detailed study plan file"), and group file names and links at the end of the line or paragraph as "Files: name1, name2". Link only files the user will actually open, and never repeat the same file.',
      'Use bold only for a short bullet lead-in or one critical point. Never use bold more than once per paragraph.',
      'Write in complete sentences. Avoid nested parentheses, bracketed tags like [status], emoji or icon decorations, and arrow chains. Numbered lists such as 1. 2. 3. or ①② are fine.',
      'Spell out internal acronyms and project codenames in plain terms the user knows.',
      'Use headings only in long replies, three or fewer. Use tables only to compare multiple items by the same criteria.',
      'End with one next step or decision for the user. Do not repeat a summary at the end.',
    ],
  },
  ja: {
    heading: '## 読みやすい回答',
    items: [
      '結論から書く。最初の段落の1〜2文に答えや結果を書き、説明はその後に置く。',
      '段落の間は1行空ける。ひとつの段落にはひとつの話題だけを収める。',
      '箇条書き1つにつき考えは1つ。2行を超えるなら分ける。複数の事実を「→」「・」「、」で連ねない。',
      'コード書式（`）はユーザーがそのままコピーして入力するものだけに使う（コマンド、コード、ファイルパス、設定値、ショートカット）。数字、名前、用語、強調したい語には使わない。',
      'ファイル名を文の途中に入れない。文中では「詳細学習計画ファイル」のように役割で書き、ファイル名とリンクはその行や段落の末尾に「ファイル: 名前1, 名前2」とまとめる。リンクはユーザーが実際に開くファイルだけに付け、同じファイルは繰り返さない。',
      '太字は箇条書き冒頭の短い見出し、または見逃せない1点だけに使う。1段落につき1回を超えない。',
      '文章で書く。括弧の中に括弧を入れず、[タグ]、絵文字やアイコン装飾、矢印の羅列を使わない。順序付きリスト（1. 2. 3. や ①②）は使ってよい。',
      '内部の略語や作業コード名は、ユーザーがわかる言葉に言い換える。',
      '見出しは長い回答のみ、3つ以下にする。表は複数項目を同じ基準で比較するときだけ使う。',
      '末尾はユーザーが次に行うこと、または決めること1つで締める。同じ内容を最後に要約し直さない。',
    ],
  },
  'zh-CN': {
    heading: '## 清晰易读的回答',
    items: [
      '结论先行。在第一段的一两句话内写出答案或结果，说明放在后面。',
      '段落之间空一行。每段只讲一件事。',
      '每条列表只表达一个观点。超过两行就拆开。不要用箭头、顿号或逗号把多个事实串在一起。',
      '行内代码格式（`）只用于用户需要原样复制输入的内容：命令、代码、文件路径、配置值和快捷键。不要用于数字、名称、术语或强调词。',
      '不要在句子中间插入文件名。行文中用“详细学习计划文件”这类描述，将文件名和链接集中放在该行或段落末尾，格式为“文件: 名称1, 名称2”。只为实际需要打开的文件加链接，同一文件不重复出现。',
      '加粗只用于列表开头的简短标题，或绝对不能遗漏的一个重点。每段不超过一次。',
      '用完整的句子表达。不要在括号内套括号，不要使用 [标签]、表情或图标装饰以及箭头串。可以使用 1. 2. 3. 或 ①② 等有序列表。',
      '内部缩写和项目代号要改写成用户能看懂的通俗说法。',
      '仅在长回答中使用标题，且不超过 3 个。仅在按相同标准对比多个项目时使用表格。',
      '结尾只给出用户下一步要做或要决定的一件事。不要在最后重复总结相同内容。',
    ],
  },
  'zh-TW': {
    heading: '## 清晰易讀的回答',
    items: [
      '結論先行。在第一段的一兩句話內寫出答案或結果，說明放在後面。',
      '段落之間空一行。每段只講一件事。',
      '每條項目只表達一個想法。超過兩行就拆開。不要用箭頭、間隔號或逗號把多個事實串在一起。',
      '行內程式碼格式（`）只用於使用者會原樣複製輸入的內容：指令、程式碼、檔案路徑、設定值與快速鍵。不要用於數字、名稱、術語或強調字詞。',
      '不要在句子中間插入檔案名稱。行文中改用「詳細學習計畫檔案」等文字描述，將檔名與連結集中在該行或段落末尾，格式為「檔案: 名稱1, 名稱2」。只為使用者實際會開啟的檔案加上連結，同一檔案不重複列出。',
      '粗體只用於清單開頭的簡短標題，或絕對不能遺漏的一個重點。每段不超過一次。',
      '用完整的句子撰寫。不要在括號內再套括號，也不要使用 [標籤]、表情符號或圖示裝飾及箭頭串接。可以使用 1. 2. 3. 或 ①② 等有序清單。',
      '內部縮寫與專案代號應換成使用者看得懂的說法。',
      '僅在長回答中使用標題，且不超過 3 個。僅在以相同標準比較多個項目時使用表格。',
      '結尾只提出一件使用者接下來要做的事或要決定的事項。不要在最後重新摘要相同內容。',
    ],
  },
  es: {
    heading: '## Respuestas claras',
    items: [
      'Empieza por la conclusión. Escribe la respuesta o el resultado en las primeras una o dos frases y deja las explicaciones para después.',
      'Deja una línea en blanco entre párrafos. Incluye una sola idea por párrafo.',
      'Una idea por viñeta. Divide cualquier punto que supere dos líneas. No encadenes varios hechos con flechas, puntos medios ni comas.',
      'Usa formato de código (`) solo para lo que el usuario copiará literalmente: comandos, código, rutas de archivo, valores de configuración y atajos. No lo uses para números, nombres, términos ni énfasis.',
      'No insertes archivos en medio de una frase. Descríbelos en el texto (por ejemplo, "el archivo del plan de estudio") y agrupa nombres y enlaces al final de la línea o párrafo como "Archivos: nombre1, nombre2". Enlaza solo archivos que el usuario vaya a abrir y no repitas el mismo archivo.',
      'Usa negrita solo en un título breve al inicio de una viñeta o en un punto imprescindible. No la uses más de una vez por párrafo.',
      'Escribe en oraciones completas. Evita paréntesis anidados, etiquetas como [estado], adornos con emojis o iconos y cadenas de flechas. Puedes usar listas numeradas como 1. 2. 3. o ①②.',
      'Explica las siglas internas y los nombres en clave con palabras que el usuario conozca.',
      'Usa encabezados solo en respuestas largas y como máximo tres. Usa tablas solo para comparar varios elementos con los mismos criterios.',
      'Termina con una única acción siguiente o decisión para el usuario. No repitas un resumen al final.',
    ],
  },
  fr: {
    heading: '## Réponses lisibles',
    items: [
      'Commencez par la conclusion. Donnez la réponse ou le résultat dans les deux premières phrases et placez les explications ensuite.',
      'Laissez une ligne vide entre les paragraphes. Ne traitez qu’un seul sujet par paragraphe.',
      'Une idée par puce. Scindez toute puce de plus de deux lignes. N’enchaînez pas plusieurs faits avec des flèches, des points médians ou des virgules.',
      'Réservez le format code (`) uniquement à ce que l’utilisateur copiera tel quel : commandes, code, chemins de fichier, valeurs de configuration et raccourcis. Ne l’utilisez pas pour les nombres, noms, termes ou mises en valeur.',
      'N’insérez pas de fichier au milieu d’une phrase. Nommez-le par son rôle dans le texte (par exemple « le fichier du plan détaillé ») et regroupez les noms et liens en fin de ligne ou de paragraphe sous « Fichiers : nom1, nom2 ». Ne mettez de lien que vers les fichiers à ouvrir et ne citez jamais deux fois le même fichier.',
      'N’utilisez le gras que pour un court libellé en début de puce ou un point essentiel. Pas plus d’une fois par paragraphe.',
      'Rédigez des phrases complètes. Évitez les parenthèses imbriquées, les balises comme [statut], les émojis ou icônes décoratifs et les suites de flèches. Les listes numérotées comme 1. 2. 3. ou ①② sont admises.',
      'Traduisez les sigles internes et noms de code en termes clairs pour l’utilisateur.',
      'N’utilisez de titres que dans les réponses longues, trois au maximum. N’utilisez de tableaux que pour comparer plusieurs éléments selon les mêmes critères.',
      'Terminez par une seule action suivante ou décision attendue de l’utilisateur. Ne récapitulez pas le même contenu à la fin.',
    ],
  },
  de: {
    heading: '## Gut lesbare Antworten',
    items: [
      'Mit dem Ergebnis beginnen. Nenne die Antwort oder das Resultat in den ersten ein bis zwei Sätzen und stelle Erklärungen dahinter.',
      'Zwischen Absätzen eine Leerzeile lassen. Pro Absatz nur ein Thema behandeln.',
      'Ein Gedanke pro Aufzählungspunkt. Punkte über zwei Zeilen aufteilen. Mehrere Fakten nicht mit Pfeilen, Mittelpunkten oder Kommas aneinanderreihen.',
      'Inline-Code (`) nur für Text verwenden, den der Nutzer unverändert kopiert: Befehle, Code, Dateipfade, Konfigurationswerte und Tastenkürzel. Nicht für Zahlen, Namen, Fachbegriffe oder Hervorhebungen.',
      'Dateien nicht mitten im Satz einfügen. Im Text beschreibend benennen (etwa „die detaillierte Lernplan-Datei“) und Dateinamen sowie Links am Ende der Zeile oder des Absatzes gesammelt als „Dateien: Name1, Name2“ angeben. Nur Dateien verlinken, die der Nutzer wirklich öffnet, und keine Datei doppelt nennen.',
      'Fettschrift nur für eine kurze Einleitung vor einem Punkt oder für eine einzige unverzichtbare Aussage nutzen. Höchstens einmal pro Absatz.',
      'In vollständigen Sätzen schreiben. Keine verschachtelten Klammern, keine [Markierungen], keine Emojis oder Symbol-Verzierungen und keine Pfeilketten verwenden. Nummerierte Listen wie 1. 2. 3. oder ①② sind erlaubt.',
      'Interne Abkürzungen und Projektnamen durch allgemein verständliche Begriffe ersetzen.',
      'Überschriften nur in langen Antworten und höchstens drei. Tabellen nur verwenden, wenn mehrere Einträge nach denselben Kriterien verglichen werden.',
      'Mit genau einer nächsten Handlung oder Entscheidung für den Nutzer schließen. Dasselbe am Ende nicht noch einmal zusammenfassen.',
    ],
  },
  pt: {
    heading: '## Respostas legíveis',
    items: [
      'Comece pela conclusão. Escreva a resposta ou o resultado nas primeiras uma ou duas frases e deixe a explicação para depois.',
      'Deixe uma linha em branco entre parágrafos. Trate apenas de um assunto por parágrafo.',
      'Uma ideia por marcador. Divida qualquer item com mais de duas linhas. Não encadeie vários fatos com setas, pontos médios ou vírgulas.',
      'Use formatação de código (`) apenas no que o usuário vai copiar literalmente: comandos, código, caminhos de arquivo, valores de configuração e atalhos. Não use em números, nomes, termos ou ênfase.',
      'Não coloque arquivos no meio da frase. Descreva-os em palavras no texto (como "o arquivo do plano detalhado") e reúna os nomes e links ao final da linha ou do parágrafo como "Arquivos: nome1, nome2". Crie links apenas para arquivos que o usuário realmente abrirá e não repita o mesmo arquivo.',
      'Use negrito apenas em um título curto no início do tópico ou em um único ponto essencial. Nunca mais de uma vez por parágrafo.',
      'Escreva em frases completas. Evite parênteses dentro de parênteses, rótulos como [status], enfeites com emojis ou ícones e sequências de setas. Listas numeradas como 1. 2. 3. ou ①② são permitidas.',
      'Explique siglas internas e codinomes de projeto em termos que o usuário conheça.',
      'Use títulos apenas em respostas longas, no máximo três. Use tabelas apenas para comparar vários itens pelos mesmos critérios.',
      'Encerre com apenas uma próxima ação ou decisão para o usuário. Não repita um resumo no final.',
    ],
  },
});

const MANUAL_HEADINGS_RE = /^#{1,6}\s*(?:읽기\s*쉬운\s*답|readable\s+repl(?:y|ies)|読みやすい回答|清晰易读的回答|清晰易讀的回答|respuestas\s+claras|réponses\s+lisibles|gut\s+lesbare\s+antworten|respostas\s+legíveis)\s*$/im;

/**
 * 원시 언어·로캘 값을 BCP-47 형태로 정규화한다.
 * 'auto' -> 'auto', 무효·무시 값(C, POSIX, 빈 문자열, 특수문자 포함 등) -> null.
 */
export function normalizeLangTag(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (/^auto$/i.test(s)) return 'auto';
  // POSIX 인코딩·변형 접미사 제거 (.UTF-8, @euro 등)
  s = s.replace(/\.[A-Za-z0-9_-]+$/, '').replace(/@[A-Za-z0-9_-]+$/, '').trim();
  if (!s || /^(c|posix)$/i.test(s)) return null;
  s = s.replace(/_/g, '-');
  if (!BCP47_RE.test(s)) return null;
  const parts = s.split('-');
  return parts.map((p, idx) => {
    if (idx === 0) return p.toLowerCase();
    if (p.length === 2 && /^[a-zA-Z]{2}$/.test(p)) return p.toUpperCase();
    if (p.length === 4 && /^[a-zA-Z]{4}$/.test(p)) return p[0].toUpperCase() + p.slice(1).toLowerCase();
    return p.toLowerCase();
  }).join('-');
}

/**
 * 정규화된 태그를 9개 내장 번역 키 중 하나로 매핑한다. 지원하지 않으면 null.
 */
export function resolveBuiltinLang(tag) {
  const norm = normalizeLangTag(tag);
  if (!norm || norm === 'auto') return null;
  const lower = norm.toLowerCase();
  if (lower === 'ko' || lower.startsWith('ko-')) return 'ko';
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  if (lower === 'ja' || lower.startsWith('ja-')) return 'ja';
  if (
    lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo' ||
    lower === 'zh-hant' || lower.startsWith('zh-hant-')
  ) return 'zh-TW';
  if (
    lower === 'zh' || lower === 'zh-cn' || lower === 'zh-sg' ||
    lower === 'zh-hans' || lower.startsWith('zh-hans-')
  ) return 'zh-CN';
  if (lower === 'es' || lower.startsWith('es-')) return 'es';
  if (lower === 'fr' || lower.startsWith('fr-')) return 'fr';
  if (lower === 'de' || lower.startsWith('de-')) return 'de';
  if (lower === 'pt' || lower.startsWith('pt-')) return 'pt';
  return null;
}

/**
 * 마커 구역·HTML 주석·펜스 코드블록을 떼어낸 순수 본문만 남긴다.
 */
export function stripNonProseForLangDetection(markdown) {
  let s = String(markdown || '');
  // 기존 마커 블록 제거 (정상이든 부분적이든 본문 감지를 오염시키지 않게)
  s = s.replace(/<!--\s*antigravity-implant:readable-replies:start\b[^>]*-->[\s\S]*?<!--\s*antigravity-implant:readable-replies:end\s*-->/g, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/~~~[\s\S]*?~~~/g, ' ');
  return s;
}

const EXPLICIT_LANG_PATTERNS = [
  ['en', /(?:영어로\s*(?:대답|답변|응답|말|작성|설명)|영어로만|(?:always\s+)?(?:respond|reply|answer|write|speak|communicate)\s+(?:only\s+)?in\s+english|\benglish\s+only\b|英語で(?:回答|返信|返答|出力)|用英语(?:回答|回复))/i],
  ['ko', /(?:한국어로\s*(?:대답|답변|응답|말|작성|설명)|한국어만|(?:always\s+)?(?:respond|reply|answer|write|speak|communicate)\s+(?:only\s+)?in\s+korean|\bkorean\s+only\b|韓国語で(?:回答|返信|返答|出力)|用韩语(?:回答|回复))/i],
  ['ja', /(?:일본어로\s*(?:대답|답변|응답|말|작성|설명)|일본어만|(?:always\s+)?(?:respond|reply|answer|write|speak|communicate)\s+(?:only\s+)?in\s+japanese|\bjapanese\s+only\b|日本語で(?:回答|返信|返答|出力|書|話)|用日语(?:回答|回复))/i],
  ['zh-TW', /(?:번체\s*중국어로\s*(?:대답|답변|응답|작성)|대만어로|(?:always\s+)?(?:respond|reply|answer|write|speak)\s+(?:only\s+)?in\s+traditional\s+chinese|請?用繁體中文(?:回答|回覆))/i],
  ['zh-CN', /(?:(?:간체\s*)?중국어로\s*(?:대답|답변|응답|작성)|(?:always\s+)?(?:respond|reply|answer|write|speak)\s+(?:only\s+)?in\s+(?:simplified\s+)?chinese|请?用(?:简体)?中文(?:回答|回复))/i],
  ['es', /(?:스페인어로\s*(?:대답|답변|응답|작성)|(?:always\s+)?(?:respond|reply|answer|write|speak)\s+(?:only\s+)?in\s+spanish|responde(?:r)?\s+(?:siempre\s+)?en\s+español)/i],
  ['fr', /(?:프랑스어로\s*(?:대답|답변|응답|작성)|(?:always\s+)?(?:respond|reply|answer|write|speak)\s+(?:only\s+)?in\s+french|réponds?\s+(?:toujours\s+)?en\s+français|répondre\s+(?:toujours\s+)?en\s+français)/i],
  ['de', /(?:독일어로\s*(?:대답|답변|응답|작성)|(?:always\s+)?(?:respond|reply|answer|write|speak)\s+(?:only\s+)?in\s+german|antworte(?:n)?\s+(?:immer\s+)?auf\s+deutsch)/i],
  ['pt', /(?:포르투갈어로\s*(?:대답|답변|응답|작성)|(?:always\s+)?(?:respond|reply|answer|write|speak)\s+(?:only\s+)?in\s+portuguese|responda\s+(?:sempre\s+)?em\s+português)/i],
];

const EN_COMMON_WORDS_RE = /\b(?:the|and|for|with|not|always|never|use|file|files|response|reply|answer|must|should|only|write|code|when|that|this|from|your)\b/gi;
const TRAD_ONLY_HANZI_RE = /[體國學應該寫點說讀這為來時會對門問開關機廣東臺灣畫書專業與實際驗證錯處箇]/g;
const SIMP_ONLY_HANZI_RE = /[体国学应该写点说读这为来时会对门问开关机广东台湾画书专业与实际验证错处个]/g;

/**
 * 기존 GEMINI.md 순수 본문에서 언어를 추정한다. 추정 불가 시 null.
 */
export function inferLangFromMarkdown(markdown) {
  const clean = stripNonProseForLangDetection(markdown);
  if (!clean.trim()) return null;

  for (const [lang, re] of EXPLICIT_LANG_PATTERNS) {
    if (re.test(clean)) return lang;
  }

  const hangul = (clean.match(/[가-힣]/g) || []).length;
  if (hangul >= 15) return 'ko';

  const kana = (clean.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
  if (kana >= 10) return 'ja';

  const hanzi = (clean.match(/[\u4E00-\u9FFF]/g) || []).length;
  if (hanzi >= 15) {
    const trad = (clean.match(TRAD_ONLY_HANZI_RE) || []).length;
    const simp = (clean.match(SIMP_ONLY_HANZI_RE) || []).length;
    return trad > simp ? 'zh-TW' : 'zh-CN';
  }

  const nonLatin = (clean.match(/[\u0400-\u04FF\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/g) || []).length;
  const latin = (clean.match(/[a-zA-Z]/g) || []).length;
  const enWords = (clean.match(EN_COMMON_WORDS_RE) || []).length;
  if (nonLatin === 0 && latin >= 80 && enWords >= 5) return 'en';

  return null;
}

/**
 * 사용자 설정·기존 규칙·OS 로캘 우선순위에 따라 적용 언어를 결정한다.
 */
export function detectLanguage(opts = {}) {
  const {
    cliLang,
    implantConfig,
    appConfig,
    existingMarkdown,
    env = process.env,
    osLocale,
    intlLocale,
  } = opts;

  if (cliLang != null && String(cliLang).trim() !== '') {
    const norm = normalizeLangTag(cliLang);
    if (!norm) {
      return { error: `지원하지 않는 언어 태그 형식입니다: ${String(cliLang)}` };
    }
    if (norm !== 'auto') {
      return { tag: norm, builtin: resolveBuiltinLang(norm), source: 'cli' };
    }
  }

  const pick = (candidates, source) => {
    for (const raw of candidates) {
      if (raw == null || String(raw).trim() === '') continue;
      const norm = normalizeLangTag(raw);
      if (norm && norm !== 'auto') {
        return { tag: norm, builtin: resolveBuiltinLang(norm), source };
      }
    }
    return null;
  };

  if (implantConfig && typeof implantConfig === 'object') {
    const hit = pick([implantConfig.language, implantConfig.locale], 'implant-config');
    if (hit) return hit;
  }

  if (appConfig && typeof appConfig === 'object') {
    const us = appConfig.userSettings && typeof appConfig.userSettings === 'object' ? appConfig.userSettings : {};
    const hit = pick([
      us.language, us.locale, us.uiLanguage, us.displayLanguage,
      appConfig.language, appConfig.locale,
    ], 'app-config');
    if (hit) return hit;
  }

  const mdLang = inferLangFromMarkdown(existingMarkdown);
  if (mdLang) {
    return { tag: mdLang, builtin: resolveBuiltinLang(mdLang), source: 'gemini-md' };
  }

  if (env && typeof env === 'object') {
    const hit = pick([env.ANTIGRAVITY_LANG], 'env:ANTIGRAVITY_LANG');
    if (hit) return hit;
  }

  {
    const hit = pick([osLocale], 'os-locale');
    if (hit) return hit;
  }

  if (env && typeof env === 'object') {
    const hit = pick([env.LC_ALL, env.LC_MESSAGES, env.LANG], 'env');
    if (hit) return hit;
  }

  {
    let resolved = intlLocale;
    if (resolved === undefined) {
      try { resolved = Intl.DateTimeFormat().resolvedOptions().locale; } catch { resolved = ''; }
    }
    const hit = pick([resolved], 'intl');
    if (hit) return hit;
  }

  return { tag: 'en', builtin: 'en', source: 'default' };
}

/**
 * 지정된 언어 태그에 맞는 마커 포함 블록 문자열을 생성한다 (항상 LF 기반).
 */
export function renderReadableReplies(langTag) {
  const norm = normalizeLangTag(langTag);
  if (!norm || norm === 'auto') {
    throw new Error(`유효하지 않은 언어 태그입니다: ${String(langTag)}`);
  }
  const builtin = resolveBuiltinLang(norm);
  const markerLang = builtin || norm;
  const fallback = !builtin;
  const t = TRANSLATIONS[builtin || 'en'];
  const numbered = t.items.map((item, idx) => `${idx + 1}. ${item}`).join('\n');

  const lines = [
    startMarker(markerLang),
    t.heading,
    '',
  ];
  if (fallback) {
    lines.push(`Write replies in the user's language (${norm}) while following these rules.`, '');
  }
  lines.push(numbered, END_MARKER);

  return {
    lang: markerLang,
    requestedTag: norm,
    builtin: builtin || 'en',
    fallback,
    block: lines.join('\n'),
  };
}

/**
 * 마커 쌍의 존재 여부와 위치, 무결성을 검사한다.
 */
export function parseInstalledMarker(text) {
  const s = String(text || '');
  const starts = [...s.matchAll(START_MARKER_RE)];
  const anyStarts = [...s.matchAll(ANY_START_RE)];
  const ends = [...s.matchAll(END_MARKER_RE)];

  if (anyStarts.length !== starts.length) {
    return { present: false, ok: false, error: 'readable-replies 시작 마커 형식이 손상되었습니다.' };
  }
  if (starts.length === 0 && ends.length === 0) {
    return { present: false, ok: true };
  }
  if (starts.length > 1 || ends.length > 1) {
    return { present: false, ok: false, error: 'readable-replies 마커가 2개 이상 중복되어 있습니다.' };
  }
  if (starts.length !== 1 || ends.length !== 1) {
    return { present: false, ok: false, error: 'readable-replies 시작·끝 마커 중 하나가 빠져 있습니다.' };
  }
  const startMatch = starts[0];
  const endMatch = ends[0];
  const startIdx = startMatch.index;
  const endIdx = endMatch.index + endMatch[0].length;
  if (endMatch.index < startIdx + startMatch[0].length) {
    return { present: false, ok: false, error: 'readable-replies 끝 마커가 시작 마커보다 앞에 있습니다.' };
  }
  const langRaw = startMatch[1];
  const lang = normalizeLangTag(langRaw);
  if (!lang || lang === 'auto') {
    return { present: false, ok: false, error: `readable-replies 마커의 언어 태그가 올바르지 않습니다: ${langRaw}` };
  }
  return { present: true, ok: true, lang, start: startIdx, end: endIdx };
}

/**
 * 마커 바깥에 수동으로 작성된 "읽기 쉬운 답" 제목이 있는지 확인한다.
 */
export function hasManualReadableSection(text) {
  const withoutComments = String(text || '')
    .replace(/<!--\s*antigravity-implant:readable-replies:start\b[^>]*-->[\s\S]*?<!--\s*antigravity-implant:readable-replies:end\s*-->/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '');
  return MANUAL_HEADINGS_RE.test(withoutComments);
}

/**
 * 기존 마크다운에 마커 블록을 추가하거나 제자리 갱신한다.
 */
export function upsertReadableBlock(existingText, blockText, { force = false } = {}) {
  const raw = String(existingText || '');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lfRaw = raw.replace(/\r\n/g, '\n');
  const lfBlock = String(blockText || '').replace(/\r\n/g, '\n').trim();

  const parsed = parseInstalledMarker(lfRaw);
  if (!parsed.ok) {
    return { status: 'broken', error: parsed.error, text: raw };
  }

  let nextLf;
  let status;
  if (parsed.present) {
    const existingSlice = lfRaw.slice(parsed.start, parsed.end);
    if (existingSlice === lfBlock) {
      return { status: 'unchanged', text: raw, lang: parsed.lang };
    }
    nextLf = lfRaw.slice(0, parsed.start) + lfBlock + lfRaw.slice(parsed.end);
    status = 'updated';
  } else {
    if (!force && hasManualReadableSection(lfRaw)) {
      return { status: 'skipped-manual', text: raw };
    }
    const trimmed = lfRaw.replace(/[ \t\n]+$/, '');
    if (!trimmed) {
      nextLf = lfBlock + '\n';
    } else {
      nextLf = trimmed + '\n\n' + lfBlock + '\n';
    }
    status = 'added';
  }

  const out = eol === '\r\n' ? nextLf.replace(/\n/g, '\r\n') : nextLf;
  if (out === raw) return { status: 'unchanged', text: raw, lang: parsed.lang };
  return { status, text: out };
}

/**
 * 기존 마크다운에서 마커 구역과 불필요한 인접 빈 줄만 제거한다.
 */
export function removeReadableBlock(existingText) {
  const raw = String(existingText || '');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lfRaw = raw.replace(/\r\n/g, '\n');

  const parsed = parseInstalledMarker(lfRaw);
  if (!parsed.ok) {
    return { status: 'broken', error: parsed.error, text: raw };
  }
  if (!parsed.present) {
    return { status: 'absent', text: raw };
  }

  let before = lfRaw.slice(0, parsed.start);
  let after = lfRaw.slice(parsed.end);

  // 블록 앞뒤 공백·빈 줄이 남지 않도록 깔끔하게 이어 붙인다
  before = before.replace(/[ \t]*\n*$/, '');
  after = after.replace(/^[ \t]*\n*/, '');

  let nextLf;
  if (!before && !after) {
    nextLf = '';
  } else if (!before) {
    nextLf = after;
  } else if (!after) {
    nextLf = before + '\n';
  } else {
    nextLf = before + '\n\n' + after;
  }

  const out = eol === '\r\n' ? nextLf.replace(/\n/g, '\r\n') : nextLf;
  return { status: 'removed', text: out, lang: parsed.lang };
}
