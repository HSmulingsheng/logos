import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load } from './espeak_ctrl.mjs'
const ROOT='/Users/chenyuhui/Desktop/Deepseek workplace/逻各斯'
const es = await load()
const greek = JSON.parse(readFileSync(ROOT+'/data/greek.json','utf8'))
const words = greek.map(r=>(r._raw||{}).Greek||'').filter(w=>/[\u0370-\u03ff\u1f00-\u1fff]/.test(w))
console.log('words',words.length)
const inv = new Map()
let n=0
for (const w of words){
  const clean = w.replace(/\[[^\]]*\]/g,'').replace(/[^\u0370-\u03ff\u1f00-\u1fff\s·,.;·]/g,' ').trim()
  if(!clean) continue
  try{
    const ipa = es.phonemes(clean)
    if(!ipa) continue
    n++
    for(const seg of ipa.split('_')) if(seg) inv.set(seg,(inv.get(seg)||0)+1)
  }catch(e){}
}
const sorted=[...inv.entries()].sort((a,b)=>b[1]-a[1])
console.log('phonemized',n,'segments',sorted.length)
console.log(sorted.map(([s,c])=>`${s}(${c})`).join(' '))
writeFileSync(fileURLToPath(new URL('../out/grc_phoneme_inventory.json',import.meta.url)),
  JSON.stringify({n_words:n, inventory:sorted},null,1))
