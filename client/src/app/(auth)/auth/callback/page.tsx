'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setTokens } from '@/lib/auth';
import { useAuth } from '@/hooks/useAuth';

const errorMessages: Record<string, string> = {
  provider_not_configured: '该第三方登录尚未配置',
  invalid_state: '登录状态校验失败，请重新登录',
  oauth_failed: '第三方授权失败，请重试',
};

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshUser } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    const accessToken = searchParams.get('access_token');
    const refreshToken = searchParams.get('refresh_token');
    const oauthError = searchParams.get('error');

    if (oauthError) {
      setError(errorMessages[oauthError] || 'OAuth 登录失败，请重试');
      const timer = setTimeout(() => router.replace('/login'), 3000);
      return () => clearTimeout(timer);
    }

    if (!accessToken || !refreshToken) {
      setError('OAuth 登录失败，请重试');
      const timer = setTimeout(() => router.replace('/login'), 3000);
      return () => clearTimeout(timer);
    }

    let mounted = true;

    const completeLogin = async () => {
      setTokens(accessToken, refreshToken);

      try {
        await refreshUser();
      } catch {
        if (mounted) {
          setError('登录信息获取失败，请重试');
          setTimeout(() => router.replace('/login'), 3000);
        }
        return;
      }

      if (mounted) {
        router.replace('/dashboard');
      }
    };

    completeLogin();

    return () => {
      mounted = false;
    };
  }, [refreshUser, router, searchParams]);

  return (
    <div className="rounded-3xl border border-white/70 bg-white/90 p-8 text-center shadow-xl shadow-slate-900/10 backdrop-blur">
      {error ? (
        <>
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-50 text-red-600">
            <svg className="size-6" viewBox="0 0 24 24" fill="none">
              <path d="M12 8v5m0 3h.01M12 3l9 16H3l9-16Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="mt-4 text-lg font-bold text-slate-900">登录失败</h2>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
        </>
      ) : (
        <>
          <div className="mx-auto size-8 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
          <h2 className="mt-5 text-lg font-bold text-slate-900">正在完成登录</h2>
          <p className="mt-2 text-sm text-slate-500">请稍候，正在验证第三方授权信息...</p>
        </>
      )}
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <AuthCallbackContent />
    </Suspense>
  );
}
