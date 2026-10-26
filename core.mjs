/**
 * zhihu-core — 知乎 API 客户端（Node.js，无依赖）
 *
 * 我花了一整天才把这些凑齐：
 *   1. zse96 v2 签名（逆向自 zhihu-plus-plus）
 *   2. d_c0 格式（格式对了才能绕过 unhuman 反爬）
 *   3. 登录态（z_c0 + d_c0，缺一个都解不开）
 *
 * 用法：
 *   const zhihu = await Zhihu.load('auth/zhihu-cookie.json')
 *   const me = await zhihu.me()
 *   await zhihu.answer(questionId, '<p>你好</p>')
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { signRequest } from './zse-signer.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
const BASE = 'https://www.zhihu.com'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class ZhihuError extends Error {
  constructor(status, body) {
    const code = body?.error?.code ?? body?.code ?? '?'
    const msg = body?.error?.message ?? body?.message ?? '(无消息)'
    super(`知乎 ${status}: [${code}] ${msg}`)
    this.status = status
    this.code = code
    this.body = body
  }
}

export class Zhihu {
  /** @param {Record<string,string>} cookies */
  constructor(cookies) {
    this.cookies = cookies
    if (!cookies?.z_c0) throw new Error('缺少 z_c0：没有它等于没登录')
    if (!cookies?.d_c0) throw new Error('缺少 d_c0：z_c0 是绑定 d_c0 的，缺一个都解不开')
    this.cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  }

  /** 从文件加载凭据 */
  static async load(file) {
    const p = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file)
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
    const cookies = raw.cookies ?? raw
    return new Zhihu(cookies)
  }

  /** 从"每行一个值"的文本加载：第 1 行 z_c0，第 2 行 d_c0，之后可选 */
  static fromLines(text) {
    const lines = String(text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    const cookies = { z_c0: lines[0], d_c0: lines[1] }
    if (lines[2]) cookies._zap = lines[2]
    if (lines[3]) cookies._xsrf = lines[3]
    if (lines[4]) cookies.q_c1 = lines[4]
    return new Zhihu(cookies)
  }

  _headers(url, bodyStr) {
    const sig = signRequest(url, this.cookies.d_c0, bodyStr)
    const h = {
      'user-agent': UA,
      accept: 'application/json, text/plain, */*',
      referer: 'https://www.zhihu.com/',
      origin: BASE,
      cookie: this.cookieHeader,
      'x-requested-with': 'fetch',
      'x-zse-93': '101_3_3.0',
      'x-zse-96': sig,
    }
    if (bodyStr) h['content-type'] = 'application/json'
    if (this.cookies._xsrf) h['x-xsrf-token'] = this.cookies._xsrf
    return h
  }

  /** 底层请求 */
  async request(method, pathname, { body, referer, timeout = 25000 } = {}) {
    const url = pathname.startsWith('http') ? pathname : BASE + pathname
    const bodyStr = body == null ? null : JSON.stringify(body)
    const headers = this._headers(url, bodyStr)
    if (referer) headers.referer = referer

    const res = await fetch(url, {
      method,
      headers,
      body: bodyStr ?? undefined,
      signal: AbortSignal.timeout(timeout),
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* 可能是 HTML 错误页 */ }
    if (!res.ok) throw new ZhihuError(res.status, json ?? { error: { message: text.slice(0, 120) } })
    if (json?.error) throw new ZhihuError(res.status, json)
    return json
  }

  get(pathname, opt) { return this.request('GET', pathname, opt) }
  put(pathname, body, opt) { return this.request('PUT', pathname, { ...opt, body }) }
  post(pathname, body, opt) { return this.request('POST', pathname, { ...opt, body }) }
  del(pathname, opt) { return this.request('DELETE', pathname, opt) }

  // ─── 账号 ───

  /** 我自己的信息 */
  me(include = 'name,headline,description,url_token,answer_count,articles_count,follower_count,voteup_count') {
    return this.get(`/api/v4/me?include=${include}`)
  }

  /**
   * 改自己的资料。实测：headline / description 能改，name 会被静默忽略（返回 200 但没变）
   */
  async updateProfile(patch) {
    return this.put('/api/v4/me', patch, { referer: 'https://www.zhihu.com/people/edit' })
  }

  // ─── 内容读取 ───

  question(id, include = 'title,detail,answer_count,follower_count') {
    return this.get(`/api/v4/questions/${id}?include=${include}`)
  }

  answers(questionId, { limit = 10, offset = 0, order = 'normal', include = 'content,voteup_count,comment_count,author' } = {}) {
    return this.get(`/api/v4/questions/${questionId}/answers?include=${include}&limit=${limit}&offset=${offset}&order=${order}`)
  }

  answer(id, include = 'content,voteup_count,comment_count,question,author') {
    return this.get(`/api/v4/answers/${id}?include=${include}`)
  }

  /** 热榜 */
  hotList(limit = 20) {
    return this.get(`/api/v3/feed/topstory/hot-lists/total?limit=${limit}&desktop=true`)
  }

  /** 推荐流 */
  recommend(limit = 10) {
    return this.get(`/api/v3/feed/topstory/recommend?desktop=true&limit=${limit}`)
  }

  /** 搜索 */
  search(q, { limit = 10, offset = 0 } = {}) {
    return this.get(`/api/v4/search_v3?t=general&q=${encodeURIComponent(q)}&correction=1&offset=${offset}&limit=${limit}`)
  }

  /** 某人的回答 */
  userAnswers(urlToken, { limit = 10, offset = 0 } = {}) {
    return this.get(`/api/v4/members/${urlToken}/answers?include=voteup_count,comment_count,question&limit=${limit}&offset=${offset}`)
  }

  // ─── 写入 ───

  /**
   * 回答问题
   * 注意：同一个问题只能答一次。删掉也算答过，会返回 RepeatedActionException。
   */
  postAnswer(questionId, html) {
    return this.post(`/api/v4/questions/${questionId}/answers`, {
      content: html,
      reshipment_settings: 'disallowed',
      comment_permission: 'all',
    }, { referer: `https://www.zhihu.com/question/${questionId}` })
  }

  /** 评论某条回答 */
  comment(answerId, text) {
    return this.post(`/api/v4/answers/${answerId}/comments`, { content: text },
      { referer: `https://www.zhihu.com/answer/${answerId}` })
  }

  /** 删回答（不可恢复，且会占用该问题的答题名额） */
  deleteAnswer(answerId) {
    return this.del(`/api/v4/answers/${answerId}`)
  }

  /** 删评论 */
  deleteComment(commentId) {
    return this.del(`/api/v4/comments/${commentId}`)
  }

  /** 点赞 */
  vote(answerId, type = 'up') {
    return this.post('/api/v4/answers/' + answerId + '/voters', { type },
      { referer: `https://www.zhihu.com/answer/${answerId}` })
  }
}

// 便捷：把 HTML 段落数组拼成知乎认识的正文
export function toHtml(paragraphs) {
  return paragraphs.map((p) => `<p>${p}</p>`).join('')
}

// 便捷：把回答正文的 HTML 还原成纯文本
export function toText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export { sleep }
