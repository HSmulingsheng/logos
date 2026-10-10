/**
 * 希腊语输入转写的自检。
 *
 * 「与 Apple 一致」这一组是**硬证据**：参考输出不是手写的，而是在 macOS 上
 * 直接调用 CoreFoundation 的 `kCFStringTransformLatinGreek`
 * （即 iOS/macOS 系统自带的那套转写）跑出来的真实结果，见 tools/apple_translit_ref.py。
 *
 * 用法: node scripts/translit-test.ts（由 esbuild 打包后执行）
 */
import { transliterate } from '../src/lib/greekInput'

let pass = 0
let fail = 0
const bad: string[] = []
const t = (name: string, got: string, want: string) => {
  if (got.normalize('NFC') === want.normalize('NFC')) pass++
  else { fail++; bad.push(`  ${name}: 得到 ${got}  期望 ${want}`) }
}

// ---- 1) 与 Apple（iOS/macOS 系统转写）逐词一致
const APPLE: [string, string][] = [
  ["logos", "λογος"],
  ["anthropos", "ἀνθροπος"],
  ["theos", "θεος"],
  ["pater", "πατερ"],
  ["meter", "μετερ"],
  ["psyche", "ψυχε"],
  ["philosophia", "φιλοσοφια"],
  ["christos", "χριστος"],
  ["onoma", "ὀνομα"],
  ["histor", "ἱστορ"],
  ["oida", "οἰδα"],
  ["zoe", "ζοε"],
  ["eirene", "εἰρενε"],
  ["adelphos", "ἀδελφος"],
  ["angelos", "ἀγγελος"],
  ["basileia", "βασιλεια"],
  ["doxa", "δοξα"],
  ["ekklesia", "ἐκκλεσια"],
  ["pistis", "πιστις"],
  ["charis", "χαρις"],
  ["nomos", "νομος"],
  ["soma", "σομα"],
  ["logou", "λογου"],
  ["basileus", "βασιλευς"],
  ["polemos", "πολεμος"],
  ["nyx", "νυξ"],
  ["hemera", "ἑμερα"],
  ["ouranos", "οὐρανος"],
  ["sophia", "σοφια"],
  ["kardia", "καρδια"],
  ["kosmos", "κοσμος"],
  ["anthropos", "ἀνθροπος"],
  ["agape", "ἀγαπε"],
  ["elpis", "ἐλπις"],
  ["dynamis", "δυναμις"],
  ["ergon", "ἐργον"],
  ["phone", "φονε"],
  ["kephale", "κεφαλε"],
  ["cheir", "χειρ"],
  ["pous", "πους"],
  ["ophthalmos", "ὀφθαλμος"],
  ["stoma", "στομα"],
  ["kardia", "καρδια"],
  ["sarx", "σαρξ"],
  ["pneuma", "πνευμα"],
  ["psyche", "ψυχε"],
  ["soma", "σομα"],
  ["nekros", "νεκρος"],
  ["zao", "ζαο"],
  ["grapho", "γραφο"],
  ["lego", "λεγο"],
  ["lysis", "λυσις"],
  ["poiesis", "ποιεσις"],
  ["protos", "προτος"],
  ["deuteros", "δευτερος"],
  ["tritos", "τριτος"],
  ["tetartos", "τεταρτος"],
  ["pemptos", "πεμπτος"],
  ["ekatos", "ἐκατος"],
  ["chilioi", "χιλιοι"],
  ["mega", "μεγα"],
  ["mikros", "μικρος"],
  ["kalos", "καλος"],
  ["kakos", "κακος"],
  ["agathos", "ἀγαθος"],
  ["dikaios", "δικαιος"],
  ["alethinos", "ἀλεθινος"],
  ["hagios", "ἁγιος"],
  ["hieron", "ἱερον"],
  ["prophetes", "προφετες"],
  ["apostolos", "ἀποστολος"],
  ["mathitis", "μαθιτις"],
  ["didaskalos", "διδασκαλος"],
  ["kyrios", "κυριος"],
  ["theos", "θεος"],
  ["patris", "πατρις"],
  ["meter", "μετερ"],
  ["adelphos", "ἀδελφος"],
  ["huios", "υἱος"],
  ["thygater", "θυγατερ"],
  ["thauma", "θαυμα"],
  ["theoria", "θεορια"],
  ["praxis", "πραξις"],
  ["ethos", "ἐθος"],
  ["pathos", "παθος"],
  ["krisis", "κρισις"],
  ["gnosis", "γνοσις"],
  ["doxa", "δοξα"],
  ["time", "τιμε"],
  ["arete", "ἀρετε"],
  ["techne", "τεχνε"],
  ["physis", "φυσις"],
  ["Italien", "Ἰταλιεν"],
  ["Hellas", "Ἑλλας"],
  ["Athena", "Ἀθενα"],
  ["Apollon", "Ἀπολλον"],
  ["Zeus", "Ζευς"],
  ["Hera", "Ἑρα"],
  ["Poseidon", "Ποσειδον"],
  ["Hermes", "Ἑρμες"],
  ["Artemis", "Ἀρτεμις"],
  ["Achilleus", "Ἀχιλλευς"],
  ["Hektor", "Ἑκτορ"],
  ["Odysseus", "Ὀδυσσευς"],
  ["Penelope", "Πενελοπε"],
  ["Agamemnon", "Ἀγαμεμνον"],
  ["Menelaos", "Μενελαος"],
  ["Alexandros", "Ἀλεξανδρος"],
  ["Philippos", "Φιλιππος"],
  ["Sokrates", "Σοκρατες"],
  ["Platon", "Πλατον"],
  ["Aristoteles", "Ἀριστοτελες"],
  ["Thoukydides", "Θουκυδιδες"],
  ["Herodotos", "Ἑροδοτος"],
  ["Xenophon", "Ξενοφον"],
  ["Euripides", "Εὐριπιδες"],
  ["Sophokles", "Σοφοκλες"],
  ["Biblion", "Βιβλιον"],
  ["gramma", "γραμμα"],
  ["stoicheion", "στοιχειον"],
  ["syllabe", "συλλαβε"],
  ["lexis", "λεξις"],
  ["logos", "λογος"],
  ["mythos", "μυθος"],
  ["ainos", "αἰνος"],
  ["ainigma", "αἰνιγμα"],
  ["houtos", "οὑτος"],
  ["ekeinos", "ἐκεινος"],
  ["toioutos", "τοιουτος"],
  ["posos", "ποσος"],
  ["tosos", "τοσος"],
  ["hosos", "ὁσος"],
  ["hekastos", "ἑκαστος"],
  ["allos", "ἀλλος"],
  ["heteros", "ἑτερος"],
  ["poieo", "ποιεο"],
  ["lambano", "λαμβανο"],
  ["echo", "ἐχο"],
  ["legomen", "λεγομεν"],
  ["graphomen", "γραφομεν"],
  ["didomi", "διδομι"],
  ["histemi", "ἱστεμι"],
  ["tithemi", "τιθεμι"]
]
for (const [latin, want] of APPLE) t(`Apple ${latin}`, transliterate(latin, 'translit'), want)

// ---- 2) 数字变音符号
const DIGITS: [string, string][] = [
  ['logos1', 'λογός'], ['lo1gos', 'λόγος'], ['anthrō3pos', 'ἀνθρῶπος'],
  ['hēme1ra', 'ἡμέρα'], ['ha1', 'ἅ'], ['a5', 'ἀ'], ['a4', 'ἁ'],
  ['a41', 'ἅ'], ['a51', 'ἄ'], ['tōi', 'τῳ'], ['hēi', 'ᾑ'],
  ['theos1', 'θεός'], ['a3', 'ἆ'], ['ou1', 'οὔ'], ['ha1ma', 'ἅμα'],
]
for (const [latin, want] of DIGITS) t(`数字 ${latin}`, transliterate(latin, 'translit'), want)

// ---- 3) 逐字符输入
// 说明：真正的「边打边转」由 GreekInput 组件负责——它内部保留一份**原始拉丁缓冲**，
// 每次按键对整串重新转写。少了这份缓冲，逐字转写会拼不出双字母
//（`t` 先变成 τ，等 h 到来时已拼不回 θ）。
// 组件层的行为由浏览器测试 scripts/input-test.mjs 覆盖，这里只验证
// 「整串一次性转写」与「逐字累积后再转写」结果一致。
const typeIt = (keys: string, scheme: 'ios' | 'translit' | 'betacode' | 'modern' = 'translit') => {
  let raw = ''
  for (const k of keys) raw += k
  return transliterate(raw, scheme)
}
const TYPING: [string, string][] = [
  ['logos', 'λογος'], ['theos', 'θεος'], ['psyche', 'ψυχε'],
  ['anthropos', 'ἀνθροπος'], ['hēme1ra', 'ἡμέρα'], ['logos1', 'λογός'],
  ['chara', 'χαρα'], ['thēsauros', 'θησαυρος'],
]
for (const [keys, want] of TYPING) t(`整串 ${keys}`, typeIt(keys), want)

// ---- 4) 退格与混排
t('希腊语后补数字', transliterate('λογος1'), 'λογός')
t('中途词边界', transliterate('τὰ logos'), 'τὰ λογος')
t('大写', transliterate('Logos'), 'Λογος')

// ---- 5) iOS 希腊语键盘（位置映射，默认方案）
// 规格来自 iOS「希腊语」键盘的 QWERTY 键位对应：物理位置不变，只换输出字符。
const KEYMAP: Record<string, string> = {
  q: ';', w: 'ς', e: 'ε', r: 'ρ', t: 'τ', y: 'υ', u: 'θ', i: 'ι', o: 'ο', p: 'π',
  a: 'α', s: 'σ', d: 'δ', f: 'φ', g: 'γ', h: 'η', j: 'ξ', k: 'κ', l: 'λ',
  z: 'ζ', x: 'χ', c: 'ψ', v: 'ω', b: 'β', n: 'ν', m: 'μ',
}
for (const [k, v] of Object.entries(KEYMAP)) t(`键位 ${k}→${v}`, transliterate(k, 'ios'), v)
t('Shift 大写', transliterate('A', 'ios'), 'Α')
t('Shift 大写（词尾σ）', transliterate('W', 'ios'), 'Σ')
// 分号是重音死键（规格：; → ΄，再按元音生成 ά έ ή ί ό ύ ώ）
for (const [k, v] of [['a','ά'],['e','έ'],['h','ή'],['i','ί'],['o','ό'],['y','ύ'],['v','ώ']] as const)
  t(`重音 ;${k}→${v}`, transliterate(';' + k, 'ios'), v)
t('分音符 :i→ϊ', transliterate(':i', 'ios'), 'ϊ')
t('分音符 :y→ϋ', transliterate(':y', 'ios'), 'ϋ')
// 数字加多调符号：单调键盘打不出气号，这是古希腊语必需的另一半
t('柔气号 a5', transliterate('a5', 'ios'), 'ἀ')
t('粗气号 a4', transliterate('a4', 'ios'), 'ἁ')
t('扬抑符 a3', transliterate('a3', 'ios'), 'ᾶ')
t('下加字母 a6', transliterate('a6', 'ios'), 'ᾳ')
t('叠加 a41', transliterate('a41', 'ios'), 'ἅ')
t('同类后者胜 a54', transliterate('a54', 'ios'), 'ἁ')
// 词尾 σ 自动写成 ς；单打 s 仍是 σ（规格要求 s=σ）
t('词尾自动 ς', transliterate('logos', 'ios'), 'λογος')
t('词中保持 σ', transliterate('sas', 'ios'), 'σας')
// 位置映射串：λόγος=l o g o s · λόγου=l o g o y（y 才是 υ）· ἄνθρωπος=a n u r v p o s
t('键盘 λόγος', transliterate('logos', 'ios'), 'λογος')
t('键盘 λόγου', transliterate('logoy', 'ios'), 'λογου')
t('键盘 u 是 θ', transliterate('logou', 'ios'), 'λογοθ')
t('键盘 ἄνθρωπος', transliterate('anurvpos', 'ios'), 'ανθρωπος')
t('键盘显式词尾 w', transliterate('anurvpow', 'ios'), 'ανθρωπος')

console.log(`输入转写自检：${pass} 通过 / ${fail} 失败`)
if (bad.length) console.log(bad.slice(0, 20).join('\n'))
process.exit(fail === 0 ? 0 : 1)
