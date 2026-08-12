import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
        云存储文件分享平台
      </h1>
      <p className="mt-4 text-lg text-gray-600 dark:text-gray-400 text-center max-w-xl">
        上传文件，获取网络地址，他人打开链接即可在线预览和下载。
      </p>
      <div className="mt-8 flex gap-4">
        <Link
          href="/register"
          className="rounded-md bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700"
        >
          注册
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          登录
        </Link>
      </div>
    </main>
  );
}
