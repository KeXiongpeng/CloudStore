export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            云存储文件分享平台
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            上传文件，获取网络地址，在线预览和下载
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
