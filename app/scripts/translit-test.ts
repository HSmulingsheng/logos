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
for (const [latin, want] of APPLE) t(`Apple ${latin}`, transliterate(latin, 'ios'), want)

// ---- 2) 数字变音符号
const DIGITS: [string, string][] = [
  ['logos1', 'λογός'], ['lo1gos', 'λόγος'], ['anthrō3pos', 'ἀνθρῶπος'],
  ['hēme1ra', 'ἡμέρα'], ['ha1', 'ἅ'], ['a5', 'ἀ'], ['a4', 'ἁ'],
  ['a41', 'ἅ'], ['a51', 'ἄ'], ['tōi', 'τῳ'], ['hēi', 'ᾑ'],
  ['theos1', 'θεός'], ['a3', 'ἆ'], ['ou1', 'οὔ'], ['ha1ma', 'ἅμα'],
]
for (const [latin, want] of DIGITS) t(`数字 ${latin}`, transliterate(latin, 'ios'), want)

// ---- 3) 逐字符输入
// 说明：真正的「边打边转」由 GreekInput 组件负责——它内部保留一份**原始拉丁缓冲**，
// 每次按键对整串重新转写。少了这份缓冲，逐字转写会拼不出双字母
//（`t` 先变成 τ，等 h 到来时已拼不回 θ）。
// 组件层的行为由浏览器测试 scripts/input-test.mjs 覆盖，这里只验证
// 「整串一次性转写」与「逐字累积后再转写」结果一致。
const typeIt = (keys: string, scheme: 'ios' | 'betacode' | 'modern' = 'ios') => {
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

console.log(`输入转写自检：${pass} 通过 / ${fail} 失败`)
if (bad.length) console.log(bad.slice(0, 20).join('\n'))
process.exit(fail === 0 ? 0 : 1)
