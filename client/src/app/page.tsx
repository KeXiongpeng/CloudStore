import Link from 'next/link';

const features = [
  {
    title: '快速上传',
    description: '5MB 以下文件预签名直传，大文件自动分片上传，状态实时可见。',
    icon: (
      <path
        d="M12 17V6m0 0-4 4m4-4 4 4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
    color: 'bg-blue-600',
  },
  {
    title: '在线预览',
    description: '图片、视频、音频、PDF 和文本文件可直接在线浏览，减少下载等待。',
    icon: (
      <path
        d="m5 15 4-4 3 3 3-3 4 4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    ),
    color: 'bg-violet-600',
  },
  {
    title: '安全分享',
    description: '随机 URL、二维码分享、公开 / 私有控制和访问日志共同保护文件。',
    icon: (
      <path
        d="M12 3 19 6v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    ),
    color: 'bg-emerald-600',
  },
  {
    title: '配额统计',
    description: '查看存储额度、浏览量、下载量和管理后台运营数据。',
    icon: (
      <path
        d="M5 19V10m7 9V5m7 14v-6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    ),
    color: 'bg-amber-500',
  },
  {
    title: 'RESTful API',
    description: '清晰的接口边界和 JWT 鉴权，便于扩展第三方客户端与自动化流程。',
    icon: (
      <path
        d="m9 8-4 4 4 4m6-8 4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
    color: 'bg-blue-800',
  },
  {
    title: '容器化部署',
    description: 'Docker Compose 编排前端、后端、PostgreSQL、Redis 和 Nginx。',
    icon: (
      <path
        d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    ),
    color: 'bg-slate-800',
  },
];

const steps = [
  { title: '注册 / 登录', description: '支持邮箱登录，可配置 GitHub、Google 和微信登录。' },
  { title: '选择文件', description: '小文件预签名直传，大文件走分片上传。' },
  { title: '生成链接', description: '随机 URL 与二维码，自动识别可预览的文件类型。' },
  { title: '分享管理', description: '查看访问数据，随时复制、预览或删除文件。' },
];

const technologies = [
  'Next.js 14',
  'Tailwind CSS',
  'NestJS',
  'Prisma',
  'PostgreSQL',
  'Redis',
  'Qiniu S3',
  'Docker Compose',
  'Nginx',
];

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-slate-50 text-slate-900">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[820px] bg-gradient-to-b from-blue-100 via-slate-50 to-slate-50"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 top-24 -z-10 size-72 rounded-full bg-blue-200/45 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-20 top-72 -z-10 size-72 rounded-full bg-cyan-200/40 blur-3xl"
      />

      <header className="sticky top-0 z-40 border-b border-white/60 bg-white/85 backdrop-blur">
        <nav className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2 font-bold text-slate-900">
            <span className="flex size-9 items-center justify-center rounded-xl bg-blue-600 text-white">
              <svg className="size-5" viewBox="0 0 24 24" fill="none">
                <path
                  d="M17 17H7a4 4 0 1 1 .7-7.94A6 6 0 0 1 19 10.5a3.5 3.5 0 0 1-2 6.5Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            CloudShare
          </Link>

          <div className="hidden items-center gap-8 text-sm font-medium text-slate-600 md:flex">
            <a className="transition hover:text-blue-600" href="#features">产品功能</a>
            <a className="transition hover:text-blue-600" href="#workflow">使用流程</a>
            <a className="transition hover:text-blue-600" href="#stack">技术架构</a>
            <a className="transition hover:text-blue-600" href="#deploy">部署文档</a>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 sm:px-4"
            >
              登录
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 sm:px-4"
            >
              免费开始
            </Link>
          </div>
        </nav>
      </header>

      <section className="mx-auto w-full max-w-7xl px-4 pb-16 pt-16 sm:px-6 sm:pt-20 lg:px-8 lg:pb-24 lg:pt-28">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white px-4 py-2 text-xs font-medium text-blue-600 shadow-sm sm:text-sm">
            <svg className="size-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
              <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            基于 S3 协议的云存储与文件分享平台
          </span>

          <h1 className="mt-7 text-4xl font-bold leading-tight tracking-tight text-slate-900 sm:text-6xl lg:text-[64px] lg:leading-[1.18]">
            上传文件，一秒生成
            <span className="block text-blue-600">安全可预览的分享链接</span>
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
            支持大文件分片上传、在线预览、二维码分享与访问统计。前端 Next.js，后端 NestJS，对象存储兼容 S3 协议。
          </p>

          <div className="mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:gap-4">
            <Link
              href="/register"
              className="inline-flex h-12 items-center justify-center rounded-xl bg-blue-600 px-7 text-sm font-medium text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
            >
              立即上传文件
            </Link>
            <Link
              href="/login"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-blue-100 bg-white/75 px-7 text-sm font-medium text-slate-800 transition hover:border-blue-200 hover:bg-white"
            >
              登录控制台
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-14 grid max-w-3xl grid-cols-2 gap-4 sm:mt-16 lg:grid-cols-4">
          {[
            ['500 MB', '免费配额'],
            ['5 GB+', '分片上传'],
            ['12+', '核心接口'],
            ['100%', 'S3 兼容'],
          ].map(([value, label]) => (
            <div key={label} className="rounded-2xl border border-blue-50 bg-white/70 px-4 py-5 text-center shadow-sm">
              <div className="text-2xl font-bold text-blue-600 sm:text-3xl">{value}</div>
              <div className="mt-1 text-xs text-slate-500 sm:text-sm">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10">
          <div className="grid gap-0 lg:grid-cols-[260px_1fr]">
            <aside className="border-b border-slate-100 bg-slate-50/80 p-6 lg:border-b-0 lg:border-r">
              <div className="text-lg font-bold">工作台</div>
              <nav className="mt-5 space-y-2">
                {['控制面板', '上传文件', '文件管理', '个人设置'].map((item, index) => (
                  <div
                    key={item}
                    className={`rounded-xl px-4 py-3 text-sm ${
                      index === 0
                        ? 'bg-blue-50 font-medium text-blue-700'
                        : 'text-slate-600'
                    }`}
                  >
                    {item}
                  </div>
                ))}
              </nav>
              <div className="mt-8 rounded-2xl bg-blue-50 p-4">
                <div className="text-xs text-slate-500">存储空间</div>
                <div className="mt-1 text-lg font-bold">236 MB / 500 MB</div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
                  <div className="h-full w-[47%] rounded-full bg-blue-600" />
                </div>
              </div>
            </aside>

            <div className="p-5 sm:p-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <h2 className="text-xl font-bold">文件管理</h2>
                <div className="flex flex-1 items-center gap-3">
                  <div className="hidden min-w-0 flex-1 items-center rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-400 md:flex">
                    搜索文件名 / MIME 类型
                  </div>
                  <button type="button" className="ml-auto inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white">
                    上传
                  </button>
                </div>
              </div>

              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-100">
                <div className="hidden grid-cols-[1fr_90px_104px_112px_92px] gap-4 bg-slate-50 px-5 py-3 text-xs font-medium text-slate-500 md:grid">
                  <span>文件名</span><span>大小</span><span>状态</span><span>浏览 / 下载</span><span>操作</span>
                </div>
                {[
                  ['产品设计终稿.pdf', '18.2 MB', '已分享', '126 / 41'],
                  ['产品发布会.mp4', '486 MB', '分片上传', '18 / 6'],
                  ['UI 视觉规范.png', '7.4 MB', '已分享', '1 028 / 320'],
                ].map(([name, size, status, count]) => (
                  <div key={name} className="grid gap-2 border-t border-slate-100 px-5 py-4 md:grid-cols-[1fr_90px_104px_112px_92px] md:items-center md:gap-4">
                    <div className="min-w-0 font-medium text-slate-800">{name}</div>
                    <div className="text-sm text-slate-500">{size}</div>
                    <div>
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs ${
                        status === '已分享' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                      }`}>
                        {status}
                      </span>
                    </div>
                    <div className="text-sm text-slate-500">{count}</div>
                    <div className="text-sm font-medium text-blue-600">复制 · 预览</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">为文件分享设计的完整体验</h2>
          <p className="mt-4 text-slate-600">覆盖个人文件管理、公开分享和后台运营的核心能力。</p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <article key={feature.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
              <span className={`flex size-12 items-center justify-center rounded-2xl text-white ${feature.color}`}>
                <svg className="size-6" viewBox="0 0 24 24" fill="none">{feature.icon}</svg>
              </span>
              <h3 className="mt-5 text-xl font-bold">{feature.title}</h3>
              <p className="mt-3 leading-7 text-slate-600">{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="workflow" className="bg-white py-16 lg:py-24">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">四步完成安全分享</h2>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <div key={step.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                <div className="text-3xl font-bold text-blue-600">{String(index + 1).padStart(2, '0')}</div>
                <h3 className="mt-4 text-xl font-bold">{step.title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="stack" className="mx-auto w-full max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8 lg:py-24">
        <h2 className="text-3xl font-bold sm:text-4xl">技术栈与部署架构</h2>
        <div className="mx-auto mt-9 flex max-w-4xl flex-wrap justify-center gap-3">
          {technologies.map((tech) => (
            <span key={tech} className="rounded-full border border-blue-100 bg-white px-4 py-2 text-sm font-medium text-slate-600">
              {tech}
            </span>
          ))}
        </div>
      </section>

      <footer id="deploy" className="bg-slate-950 px-4 py-12 text-center text-slate-300 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="text-lg font-bold text-white">CloudShare · 云存储文件分享平台</div>
          <p className="mt-3 text-sm">一个面向面试展示的全栈学习项目 · Next.js + NestJS + S3 + Docker</p>
          <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
            <a className="hover:text-white" href="#stack">技术架构</a>
            <Link className="hover:text-white" href="/login">登录</Link>
            <Link className="hover:text-white" href="/register">注册</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

