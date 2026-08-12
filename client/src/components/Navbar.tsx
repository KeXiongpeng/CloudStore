'use client';

import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';

export default function Navbar() {
  const { user, logout } = useAuth();

  return (
    <nav className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6 dark:border-gray-800 dark:bg-gray-900">
      <Link href="/dashboard" className="text-lg font-bold text-gray-900 dark:text-white">
        CloudStore
      </Link>

      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {user?.nickname || user?.email}
        </span>
        <button
          onClick={logout}
          className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          登出
        </button>
      </div>
    </nav>
  );
}
