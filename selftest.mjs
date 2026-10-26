// 验收 zhihu-core 能不能真的跑起来
import { Zhihu, toText, toHtml, ZhihuError } from './core.mjs'
import path from 'node:path'
import { ROOT } from '../src/ffmpeg.mjs'

const z = await Zhihu.load(path.join(ROOT, 'auth', 'zhihu-cookie.json'))
console.log('✅ 加载凭据成功')

const me = await z.me()
console.log(`我的号：${me.name} | 回答 ${me.answer_count} | 关注者 ${me.follower_count} | 获赞 ${me.voteup_count}`)

await new Promise(r => setTimeout(r, 2000))
const hot = await z.hotList(5)
console.log(`\n热榜 ${hot.data.length} 条：`)
for (const it of hot.data.slice(0, 5)) {
  const t = it.target?.title || it.target?.question?.title || '(无)'
  console.log('  ·', String(t).slice(0, 44))
}

await new Promise(r => setTimeout(r, 2000))
const s = await z.search('孤独', { limit: 5 })
const hits = (s.data || []).filter(x => x.object?.type === 'answer')
console.log(`\n搜索「孤独」命中 ${hits.length} 条回答`)

await new Promise(r => setTimeout(r, 2000))
const mine = await z.userAnswers('94-50-66-60', { limit: 5 })
console.log(`\n我自己的回答 ${(mine.data || []).length} 篇：`)
for (const a of (mine.data || [])) {
  console.log(`  《${a.question?.title}》`)
  console.log(`    ${toText(a.content).slice(0, 50)}…`)
}

// 错误处理是否正常
try {
  await z.answer('999999999999')
} catch (e) {
  console.log(`\n✅ 错误处理正常：${e instanceof ZhihuError ? e.message.slice(0, 60) : e.message}`)
}
