'use client';
import { getApiErrorMessage } from '@/lib/errors';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import AuthProviderButtons from '@/components/AuthProviderButtons';

const inputClassName =
  'block h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (error: unknown) {
      setError(getApiErrorMessage(error, '登录失败，请检查邮箱和密码'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-3xl border border-white/70 bg-white/90 p-6 shadow-xl shadow-slate-900/10 backdrop-blur sm:p-8">
      <h2 className="text-2xl font-bold text-slate-900">欢迎回来</h2>
      <p className="mt-2 text-sm text-slate-500">登录后管理文件、分享链接和存储配额。</p>

      {error && (
        <div className="mt-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700">
            邮箱
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClassName}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-700">
            密码
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClassName}
            placeholder="请输入密码"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 h-11 w-full rounded-xl bg-blue-600 text-sm font-medium text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? '登录中...' : '登录'}
        </button>
      </form>

      <AuthProviderButtons />

      <div className="mt-7 text-center text-sm text-slate-500">
        还没有账号？
        <Link href="/register" className="ml-1 font-medium text-blue-600 hover:text-blue-500">
          免费注册
        </Link>
      </div>
    </div>
  );
}
