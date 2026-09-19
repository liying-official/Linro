export const responseLabels = {
  'zh-CN': {
    mode: '返回方式', redirect: 'HTTP 跳转', text: '纯文本', content: '纯文本内容',
    hint: '1–16384 字符，最多 32768 个 UTF-8 字节；保留换行。返回 HTTP 200、text/plain，不执行 HTML 或脚本。',
    warning: '纯文本不使用目标 URL、查询透传或地理分流。密码、启停、到期和次数上限继续生效；成功 GET / HEAD 文本响应各占一次限额，统计仅记录 GET。',
    stats: '查看统计', timezones: '浏览器时区（JavaScript）', ipTimezones: 'IP 时区（Cloudflare）', devices: '访问设备', mobile: '移动设备', pc: 'PC 端', none: '无',
    provenance: '浏览器时区由前端 JavaScript 上报；IP 时区来自 Cloudflare。时区身份不一致或 Tor 标记归为疑似 VPN，这不是真实 VPN 证明，存在漏检和误判。设备只采用 Cloudflare 生成的 CF-Device-Type；无法取得时显示无，不用 UA 猜测。旧数据缺失这些字段时也归入无。',
  },
  en: {
    mode: 'Response mode', redirect: 'HTTP redirect', text: 'Plain text', content: 'Plain text content',
    hint: '1–16384 characters, at most 32768 UTF-8 bytes. Line breaks are preserved. Returns HTTP 200 as text/plain; HTML and scripts are not executed.',
    warning: 'Text mode does not use a target URL, query forwarding or geographic routing. Passwords, status, expiry and limits still apply. Each successful GET / HEAD text response uses one quota slot; analytics records GET only.',
    stats: 'View analytics', timezones: 'Browser timezones (JavaScript)', ipTimezones: 'IP timezones (Cloudflare)', devices: 'Devices', mobile: 'Mobile', pc: 'PC', none: 'none',
    provenance: 'Browser timezone is reported by frontend JavaScript; IP timezone comes from Cloudflare. Different timezone identities or a Tor signal indicate suspected VPN use, not proof. False positives and missed VPNs are possible. Device uses only Cloudflare-generated CF-Device-Type; missing values show none with no UA guessing. Older events without these fields also show none.',
  },
} as const;
