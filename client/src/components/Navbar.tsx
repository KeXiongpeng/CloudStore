'use client';

import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';

interface NavbarProps {
  onMenuClick?: () => void;
}

export default function Navbar({ onMenuClick }: NavbarProps) {
  const { user, logout } = useAuth();

  return (
    <nav className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onMenuClick}
          className="flex size-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 lg:hidden"
          aria-label="打开导航菜单"
        >
          <svg className="size-5" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
            <svg className="size-4" viewBox="0 0 24 24" fill="none">
              <path
                d="M17 17H7a4 4 0 1 1 .7-7.94A6 6 0 0 1 19 10.5a3.5 3.5 0 0 1-2 6.5Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="truncate text-base font-bold text-slate-900 sm:text-lg">CloudShare</span>
        </Link>
      </div>

      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        <span className="hidden max-w-xs truncate text-sm text-slate-500 sm:block md:max-w-sm">
          {user?.nickname || user?.email}
        </span>
        <button
          type="button"
          onClick={logout}
          className="rounded-lg px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100"
        >
          登出
        </button>
      </div>
    </nav>
  );
}
