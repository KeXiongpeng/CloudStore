'use client';

import { useState } from 'react';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <Navbar onMenuClick={() => setMobileMenuOpen(true)} />
      <div className="border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-950">
        <WorkspaceSwitcher />
      </div>
      <div className="flex min-h-0 flex-1">
        <Sidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
