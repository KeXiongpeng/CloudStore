'use client';

import { useEffect, useState } from 'react';

type OAuthProvider = 'github' | 'google' | 'wechat';

const providerMeta: Record<
  OAuthProvider,
  { label: string; icon: React.ReactNode; className: string }
> = {
  github: {
    label: 'GitHub 登录',
    className: 'border-slate-200 bg-slate-950 text-white hover:bg-slate-800',
    icon: (
      <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"
        />
      </svg>
    ),
  },
  google: {
    label: 'Google 登录',
    className: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    icon: (
      <svg className="size-5" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
    ),
  },
  wechat: {
    label: '微信登录',
    className: 'border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700',
    icon: (
      <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9.3 4C5.3 4 2 6.7 2 10c0 1.8 1 3.4 2.6 4.5l-.7 2.1 2.4-1.2c.7.2 1.4.3 2.2.3h.4A6.3 6.3 0 0 1 8.6 13c0-3.1 2.9-5.5 6.4-5.5h.3C14.7 5.6 12.2 4 9.3 4Zm-1.9 4.2a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Zm3.8 0a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8ZM22 13c0-2.8-2.8-5-6.2-5S9.6 10.2 9.6 13s2.8 5 6.2 5c.6 0 1.2-.1 1.7-.2l2 1-.6-1.8A4.8 4.8 0 0 0 22 13Zm-8.3-.9a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6Zm4.2 0a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6Z" />
      </svg>
    ),
  },
};

export default function AuthProviderButtons({ divider = true }: { divider?: boolean }) {
  const [providers, setProviders] = useState<OAuthProvider[]>([]);

  useEffect(() => {
    let mounted = true;

    fetch('/api/auth/providers')
      .then((response) => (response.ok ? response.json() : { providers: [] }))
      .then((data) => {
        if (!mounted) return;
        const configured = Array.isArray(data?.providers) ? data.providers : [];
        const allowed = configured.filter((item: unknown): item is OAuthProvider =>
          typeof item === 'string' &&
          ['github', 'google', 'wechat'].includes(item),
        );
        setProviders(allowed);
      })
      .catch(() => {
        if (mounted) setProviders([]);
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (providers.length === 0) {
    return null;
  }

  return (
    <div className="mt-7">
      {divider && (
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-white px-3 text-xs text-slate-400">第三方登录</span>
          </div>
        </div>
      )}

      <div className={`space-y-3 ${divider ? 'mt-5' : ''}`}>
        {providers.map((provider) => (
          <a
            key={provider}
            href={`/api/auth/${provider}`}
            className={`flex h-11 w-full items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium transition ${providerMeta[provider].className}`}
          >
            {providerMeta[provider].icon}
            {providerMeta[provider].label}
          </a>
        ))}
      </div>
    </div>
  );
}

