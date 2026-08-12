'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setTokens } from '@/lib/auth';

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');

  useEffect(() => {
    const accessToken = searchParams.get('access_token');
    const refreshToken = searchParams.get('refresh_token');

    if (accessToken && refreshToken) {
      setTokens(accessToken, refreshToken);
      router.push('/dashboard');
    } else {
      setError('OAuth 授权失败，请重试');
      setTimeout(() => router.push('/login'), 3000);
    }
  }, [searchParams, router]);

  return (
    <div className="text-center">
      {error ? (
        <p className="text-red-600 dark:text-red-400">{error}</p>
      ) : (
        <p className="text-gray-500 dark:text-gray-400">正在处理登录...</p>
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
