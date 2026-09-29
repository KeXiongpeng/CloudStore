'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getApiErrorMessage } from '@/lib/errors';
import { useAcceptInvitation } from '@/features/workspace/api';

export default function AcceptInvitationPage() {
  const router = useRouter();
  const acceptInvitation = useAcceptInvitation();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-6 text-2xl font-bold">接受邀请</h1>
      <form
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-950"
        onSubmit={async (event) => {
          event.preventDefault();
          setError('');
          try {
            await acceptInvitation.mutateAsync(token);
            router.push('/dashboard');
          } catch (caught) {
            setError(getApiErrorMessage(caught, '邀请无效或已过期'));
          }
        }}
      >
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="token">
            邀请令牌
          </label>
          <input
            id="token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-900"
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={acceptInvitation.isPending}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {acceptInvitation.isPending ? '处理中...' : '加入工作区'}
        </button>
      </form>
    </main>
  );
}
