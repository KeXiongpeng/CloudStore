export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-4 py-10 sm:py-14">
      <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-blue-100 via-white to-slate-100" />
      <div aria-hidden className="absolute -right-20 top-16 size-72 rounded-full bg-blue-200/50 blur-3xl" />
      <div aria-hidden className="absolute -left-16 bottom-10 size-72 rounded-full bg-cyan-200/40 blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
            <svg className="size-7" viewBox="0 0 24 24" fill="none">
              <path
                d="M17 17H7a4 4 0 1 1 .7-7.94A6 6 0 0 1 19 10.5a3.5 3.5 0 0 1-2 6.5Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 className="mt-5 text-2xl font-bold text-slate-900 sm:text-3xl">
            CloudShare
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            安全上传 · 在线预览 · 一键分享
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
