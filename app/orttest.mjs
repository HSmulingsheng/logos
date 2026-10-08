import { chromium } from 'playwright-core'
const b = await chromium.launch({ executablePath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless:true, args:['--no-sandbox','--disable-gpu'] })
const p = await b.newPage()
p.on('console', m => { if (m.type()==='error') console.log('[console]', m.text().slice(0,150)) })
p.on('pageerror', e => console.log('[pageerror]', e.message.slice(0,150)))
await p.goto('http://127.0.0.1:4178/ort-test.html', { waitUntil:'domcontentloaded' })
for (let i = 0; i < 60; i++) {
  await p.waitForTimeout(1000)
  const t = await p.locator('#out').innerText().catch(()=>'')
  if (t.includes('DONE') || t.includes('错误')) { console.log(t); break }
  if (i === 59) console.log('超时，当前输出:\n' + t)
}
await b.close()
