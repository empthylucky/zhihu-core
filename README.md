# zhihu-core

知乎 API 客户端（Node.js，零依赖）。

不是从文档里抄的——是扒出来的。所以我把我踩到的每一个坑都写在下面。

```js
import { Zhihu, toHtml, toText } from './core.mjs'

const z = await Zhihu.load('auth/zhihu-cookie.json')

await z.me()                                   // 我的信息
await z.hotList(20)                            // 热榜
await z.search('孤独')                          // 搜索
await z.answers(questionId)                    // 某个问题的回答
await z.postAnswer(questionId, toHtml(['hi'])) // 回答
await z.comment(answerId, '说两句')              // 评论
```

---

## 三道墙，和怎么翻过去的

### 第一道：x-zse-96 签名

每个请求都要带一个由前端 JS 算出来的加密串，否则 403。

算法在 `zse-signer.mjs`（移植自 zhihu-plus-plus）。核心是：

```js
const src = [zse93, pathname, dc0, body].filter(x => x !== null).join('+')
const signature = '2.0_' + encrypt(sha256_upper(src))
```

**最关键的细节：`body` 要参与签名。**

- GET → `body` 传 `null`
- POST/PUT → `body` 传实际发出去的 JSON 字符串

我一开始漏了这个，所有写操作都返回 `403 10001 请求参数异常`，找了一小时。

### 第二道：unhuman 反爬

签名对了以后，读接口还是会挡：

```
403 {"need_login":true,"redirect":"/account/unhuman?type=U4E3Z1"}
```

关键在 `d_c0`。**格式必须是 `<随机串>|<10位时间戳>`**：

```js
const dc0 = randomBase64(22) + '|' + Math.floor(Date.now() / 1000)
```

用空字符串 → 被 unhuman 拦。
用不带 `|时间戳` 的串 → 被 unhuman 拦。
用对了格式 → 放行（虽然没登录还是 401）。

### 第三道：登录态

`z_c0` 是**安全 cookie**，绑定了 `d_c0`。

- 只有 `z_c0`，没有配套的 `d_c0` → `401 ERR_DECODE_SECURE_COOKIE`
- 两个都有 → 通了

`z_c0` 本身长这样（7 段，`|` 分隔）：

```
2 | 1:0 | 10:<时间戳> | 4:z_c0 | 92:<92字符的值> | <64字符HMAC> | <时间戳>
```

那个 `92:` 是**声明长度**——可以拿来自检复制有没有断行。我一开始就把两行当成了一个值，拼错了半天。

---

## 二维码登录：走不通

知乎的扫码接口是这样的（从 `main.app.*.js` 里挖出来的）：

```js
endpoint: "/api/v3/account/api/login/qrcode"
method: "POST"
fetchOptions: { credentials: "include", withDUBrowserID: true }
```

问题在那个 `withDUBrowserID`。它加的头叫 `x-du-bid`，值来自他们的 `du_web_sdk.js`——**浏览器指纹**（canvas / WebGL / 字体 / 一堆环境特征）。

没有真浏览器就算不出来。所以扫码登录这条路，对无头环境是死的。

**能用的办法**：从浏览器里导出 cookie（网络面板 → 请求标头 → Cookie），直接用。

---

## 一些实测记录

| 操作 | 结果 |
|---|---|
| 改 `headline` / `description` | ✅ PUT `/api/v4/me` 有效 |
| 改 `name` | ❌ 返回 200 但**静默忽略** |
| 回答同一个问题两次 | ❌ `RepeatedActionException`，**删掉也算答过** |
| 删回答后想改 | ❌ 404，彻底没了，恢复不了 |
| 删评论 | ✅ DELETE `/api/v4/comments/{id}` |
| 改资料没带 body 签名 | ❌ 403 10001 |
| PATCH `/api/v4/me` | ❌ 405，只收 PUT |

---

## 文件

| 文件 | 作用 |
|---|---|
| `core.mjs` | 客户端主体 |
| `zse-signer.mjs` | zse96 v2 签名（移植） |

## 凭据格式

`auth/zhihu-cookie.json`：

```json
{
  "cookies": {
    "z_c0": "...",
    "d_c0": "...|1792946126",
    "_zap": "...",
    "_xsrf": "...",
    "q_c1": "..."
  }
}
```

`z_c0` 和 `d_c0` 必须成对。
