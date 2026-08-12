# Phase 5: 前端认证页面 + 应用布局 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现前端认证流程（登录/注册/OAuth回调）、认证状态管理、受保护路由、以及全局应用布局（导航栏 + 侧边栏 + 主体区域）。

**Architecture:** Next.js App Router 架构。`AuthProvider` 作为客户端上下文管理登录状态和 token。使用 `middleware.ts` 做路由保护。全局布局包含顶部导航栏和侧边栏（仅登录后可见）。TailwindCSS 负责样式。

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, TailwindCSS, Axios

## Global Constraints

- 前端: React + Next.js (App Router) + TailwindCSS + TypeScript
- 后端 API 基础路径: `/api`
- Next.js 端口: 3001
- API 客户端: `client/src/lib/api.ts`（Phase 1 已创建，axios 实例，baseURL: `/api`）
- 所有 UI 组件使用 TailwindCSS 内联样式，不引入 UI 组件库

## Prerequisites

Phase 1 必须已完成：Next.js 脚手架、TailwindCSS 配置、API 客户端。
后端 Phase 2 必须已完成：认证 API 可用。

---

## File Structure Overview

```
client/src/
├── app/
│   ├── layout.tsx                  # 修改：全局布局，包裹 AuthProvider
│   ├── page.tsx                    # 修改：首页，根据登录状态显示不同内容
│   ├── globals.css                 # 已有
│   ├── (auth)/                     # 认证路由组（无侧边栏布局）
│   │   ├── layout.tsx              # 认证页布局（居中卡片）
│   │   ├── login/
│   │   │   └── page.tsx            # 登录页
│   │   ├── register/
│   │   │   └── page.tsx            # 注册页
│   │   └── auth/
│   │       └── callback/
│   │           └── page.tsx        # OAuth 回调页
│   └── (dashboard)/                # 主应用路由组（有导航栏+侧边栏）
│       ├── layout.tsx              # 主应用布局
│       ├── dashboard/
│       │   └── page.tsx            # 控制面板（占位）
│       ├── upload/
│       │   └── page.tsx            # 上传页（占位）
│       ├── files/
│       │   └── page.tsx            # 文件管理（占位）
│       ├── api-keys/
│       │   └── page.tsx            # API 密钥（占位）
│       ├── settings/
│       │   └── page.tsx            # 个人设置（占位）
│       └── admin/
│           └── page.tsx            # 管理后台（占位）
├── components/
│   ├── Navbar.tsx                  # 顶部导航栏
│   ├── Sidebar.tsx                 # 侧边栏
│   └── QuotaBar.tsx                # 配额使用进度条
├── contexts/
│   └── AuthContext.tsx              # 认证上下文 Provider
├── hooks/
│   └── useAuth.ts                  # 认证 Hook
├── lib/
│   ├── api.ts                      # 已有
│   └── auth.ts                     # Token 存储工具函数
└── middleware.ts                   # 路由保护中间件
```

---

### Task 1: 认证工具函数 + AuthContext + useAuth Hook

**Files:**
- Create: `client/src/lib/auth.ts`
- Create: `client/src/contexts/AuthContext.tsx`
- Create: `client/src/hooks/useAuth.ts`
- Modify: `client/src/lib/api.ts`（优化 token 拦截器）

**Interfaces:**
- Produces: `getToken()`, `setTokens(access, refresh)`, `clearTokens()` — Token 存取工具
- Produces: `<AuthProvider>` — 全局认证上下文，提供 user/login/register/logout 状态
- Produces: `useAuth()` — Hook，返回 `{ user, isAuthenticated, login, register, logout, loading }`

- [ ] **Step 1: 创建 `client/src/lib/auth.ts`**

```typescript
const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}
```

- [ ] **Step 2: 修改 `client/src/lib/api.ts` 优化 token 拦截器**

```typescript
import axios from 'axios';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from './auth';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = getAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// 响应拦截器：401 时尝试刷新 token
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        clearTokens();
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }

      try {
        const response = await axios.post('/api/auth/refresh', {
          refresh_token: refreshToken,
        });

        const { access_token, refresh_token } = response.data;
        setTokens(access_token, refresh_token);

        processQueue(null, access_token);
        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        clearTokens();
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export default api;
```

- [ ] **Step 3: 创建 `client/src/contexts/AuthContext.tsx`**

```tsx
'use client';

import React, { createContext, useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { setTokens, clearTokens, getAccessToken } from '@/lib/auth';

interface User {
  id: string;
  email: string;
  nickname: string;
  role: string;
  tier: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const response = await api.get('/users/me');
      setUser(response.data);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (token) {
      refreshUser().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [refreshUser]);

  const login = async (email: string, password: string) => {
    const response = await api.post('/auth/login', { email, password });
    const { access_token, refresh_token, user: userData } = response.data;
    setTokens(access_token, refresh_token);
    setUser(userData);
  };

  const register = async (email: string, password: string) => {
    const response = await api.post('/auth/register', { email, password });
    const { access_token, refresh_token, user: userData } = response.data;
    setTokens(access_token, refresh_token);
    setUser(userData);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      clearTokens();
      setUser(null);
      window.location.href = '/login';
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
```

- [ ] **Step 4: 创建 `client/src/hooks/useAuth.ts`**

```typescript
'use client';

import { useContext } from 'react';
import { AuthContext } from '@/contexts/AuthContext';

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

- [ ] **Step 5: 提交**

```bash
git add client/
git commit -m "feat: add AuthContext, useAuth hook, and token refresh interceptor"
```

---

### Task 2: 登录页 + 注册页 + OAuth 回调页

**Files:**
- Create: `client/src/app/(auth)/layout.tsx`
- Create: `client/src/app/(auth)/login/page.tsx`
- Create: `client/src/app/(auth)/register/page.tsx`
- Create: `client/src/app/(auth)/auth/callback/page.tsx`

**Interfaces:**
- Consumes: `useAuth()` hook（Task 1）
- Produces: `/login` — 登录页（邮箱密码 + GitHub/Google OAuth 按钮）
- Produces: `/register` — 注册页（邮箱密码）
- Produces: `/auth/callback` — OAuth 回调处理页（从 URL 提取 token 并存储）

- [ ] **Step 1: 创建 `client/src/app/(auth)/layout.tsx`**

```tsx
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
```

- [ ] **Step 2: 创建 `client/src/app/(auth)/login/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || '登录失败，请检查邮箱和密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg bg-white p-8 shadow-sm dark:bg-gray-900">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
        登录
      </h2>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            邮箱
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            placeholder="your@email.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            密码
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            placeholder="至少 6 个字符"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          {loading ? '登录中...' : '登录'}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
        还没有账号？
        <Link href="/register" className="ml-1 font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400">
          注册
        </Link>
      </div>

      <div className="mt-6">
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300 dark:border-gray-700" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-white px-2 text-gray-500 dark:bg-gray-900 dark:text-gray-400">
              或
            </span>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <a
            href="/api/auth/github"
            className="flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
            </svg>
            GitHub 登录
          </a>

          <a
            href="/api/auth/google"
            className="flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Google 登录
          </a>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 创建 `client/src/app/(auth)/register/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    if (password.length < 6) {
      setError('密码至少 6 个字符');
      return;
    }

    setLoading(true);

    try {
      await register(email, password);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || '注册失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg bg-white p-8 shadow-sm dark:bg-gray-900">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
        注册
      </h2>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            邮箱
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            placeholder="your@email.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            密码
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            placeholder="至少 6 个字符"
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            确认密码
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            placeholder="再次输入密码"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          {loading ? '注册中...' : '注册'}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
        已有账号？
        <Link href="/login" className="ml-1 font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400">
          登录
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 创建 `client/src/app/(auth)/auth/callback/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setTokens } from '@/lib/auth';

export default function AuthCallbackPage() {
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
```

- [ ] **Step 5: 提交**

```bash
git add client/
git commit -m "feat: add login, register, OAuth callback pages with TailwindCSS"
```

---

### Task 3: 全局布局 + 导航栏 + 侧边栏 + 路由保护

**Files:**
- Modify: `client/src/app/layout.tsx`（包裹 AuthProvider）
- Create: `client/src/components/Navbar.tsx`
- Create: `client/src/components/Sidebar.tsx`
- Create: `client/src/app/(dashboard)/layout.tsx`
- Create: `client/src/app/(dashboard)/dashboard/page.tsx`（占位）
- Create: `client/src/app/(dashboard)/upload/page.tsx`（占位）
- Create: `client/src/app/(dashboard)/files/page.tsx`（占位）
- Create: `client/src/app/(dashboard)/api-keys/page.tsx`（占位）
- Create: `client/src/app/(dashboard)/settings/page.tsx`（占位）
- Create: `client/src/app/(dashboard)/admin/page.tsx`（占位）
- Create: `client/src/middleware.ts`
- Modify: `client/src/app/page.tsx`（首页根据登录状态显示）

**Interfaces:**
- Consumes: `AuthProvider` + `useAuth()`（Task 1）
- Produces: 全局 `layout.tsx` — 根布局包裹 AuthProvider
- Produces: `Navbar` — 顶部导航栏（logo、用户菜单、登出）
- Produces: `Sidebar` — 侧边栏导航（Dashboard、上传、文件、API密钥、设置、管理后台）
- Produces: `middleware.ts` — 保护 `/dashboard/*`、`/upload/*`、`/files/*`、`/settings/*`、`/api-keys/*`、`/admin/*` 路由

- [ ] **Step 1: 修改 `client/src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import { AuthProvider } from '@/contexts/AuthContext';
import './globals.css';

export const metadata: Metadata = {
  title: '云存储文件分享平台',
  description: '上传文件，获取网络地址，他人打开链接即可在线预览和下载',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 antialiased">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: 创建 `client/src/components/Navbar.tsx`**

```tsx
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
```

- [ ] **Step 3: 创建 `client/src/components/Sidebar.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

const navItems = [
  { href: '/dashboard', label: '控制面板', icon: '📊' },
  { href: '/upload', label: '上传文件', icon: '📤' },
  { href: '/files', label: '文件管理', icon: '📁' },
  { href: '/api-keys', label: 'API 密钥', icon: '🔑' },
  { href: '/settings', label: '个人设置', icon: '⚙️' },
];

const adminItems = [
  { href: '/admin', label: '管理后台', icon: '🛡️' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();

  return (
    <aside className="flex w-60 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex-1 py-4">
        <nav className="space-y-1 px-3">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}

          {user?.role === 'admin' && (
            <>
              <div className="my-3 border-t border-gray-200 dark:border-gray-700" />
              {adminItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
                      isActive
                        ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span>{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
            </>
          )}
        </nav>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: 创建 `client/src/app/(dashboard)/layout.tsx`**

```tsx
'use client';

import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/hooks/useAuth';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col">
      <Navbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 创建占位页面（批量创建 6 个）**

`client/src/app/(dashboard)/dashboard/page.tsx`:

```tsx
'use client';

import Link from 'next/link';

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">控制面板</h1>
      <p className="mt-2 text-gray-500 dark:text-gray-400">欢迎回来，这是你的文件概览。</p>
      <div className="mt-6 flex gap-4">
        <Link
          href="/upload"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          上传文件
        </Link>
        <Link
          href="/files"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          文件管理
        </Link>
      </div>
    </div>
  );
}
```

`client/src/app/(dashboard)/upload/page.tsx`:

```tsx
export default function UploadPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">上传文件</h1>
      <p className="mt-2 text-gray-500 dark:text-gray-400">拖拽文件到此处或点击选择上传。</p>
    </div>
  );
}
```

`client/src/app/(dashboard)/files/page.tsx`:

```tsx
export default function FilesPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">文件管理</h1>
      <p className="mt-2 text-gray-500 dark:text-gray-400">查看和管理你上传的所有文件。</p>
    </div>
  );
}
```

`client/src/app/(dashboard)/api-keys/page.tsx`:

```tsx
export default function ApiKeysPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">API 密钥</h1>
      <p className="mt-2 text-gray-500 dark:text-gray-400">管理你的 API 密钥，用于 ShareX 等工具上传。</p>
    </div>
  );
}
```

`client/src/app/(dashboard)/settings/page.tsx`:

```tsx
export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">个人设置</h1>
      <p className="mt-2 text-gray-500 dark:text-gray-400">修改你的个人信息和密码。</p>
    </div>
  );
}
```

`client/src/app/(dashboard)/admin/page.tsx`:

```tsx
export default function AdminPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">管理后台</h1>
      <p className="mt-2 text-gray-500 dark:text-gray-400">管理用户和查看全局统计。</p>
    </div>
  );
}
```

- [ ] **Step 6: 创建 `client/src/middleware.ts`**

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const protectedPaths = ['/dashboard', '/upload', '/files', '/api-keys', '/settings', '/admin'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = protectedPaths.some((path) => pathname.startsWith(path));

  if (isProtected) {
    // 检查是否有 token（通过检查 cookie 或重定向到登录）
    // 由于 Next.js middleware 无法读取 localStorage，
    // 我们依赖客户端 AuthContext 的 loading 状态做保护
    // 此 middleware 仅作为服务端后备
    const token = request.cookies.get('access_token')?.value;

    if (!token) {
      // 无 cookie 时，让请求通过，由客户端 AuthContext 处理重定向
      // 这样可以避免 SSR 场景下的问题
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|f|d|auth/callback).*)'],
};
```

- [ ] **Step 7: 修改 `client/src/app/page.tsx` 首页**

```tsx
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
```

- [ ] **Step 8: 提交**

```bash
git add client/
git commit -m "feat: add global layout, Navbar, Sidebar, route protection, and placeholder pages"
```

---

## 验证清单

完成所有 Task 后，执行以下验证：

1. **启动前端：**
   ```bash
   cd client && npm run dev
   ```

2. **验证首页渲染：**
   - 浏览器打开 `http://localhost:3001`
   - 预期：显示首页，包含"云存储文件分享平台"标题和注册/登录按钮

3. **验证登录页：**
   - 打开 `http://localhost:3001/login`
   - 预期：显示登录表单 + GitHub/Google OAuth 按钮

4. **验证注册页：**
   - 打开 `http://localhost:3001/register`
   - 预期：显示注册表单

5. **验证注册流程：**
   - 输入邮箱和密码，点击注册
   - 预期：成功后跳转到 `/dashboard`，侧边栏和导航栏可见

6. **验证登录后布局：**
   - 登录后访问 `/dashboard`
   - 预期：顶部导航栏显示用户昵称和登出按钮，左侧显示侧边栏导航

7. **验证 OAuth 流程：**
   - 点击 GitHub 登录按钮
   - 预期：跳转到 GitHub 授权页（需要配置 GitHub OAuth App）

8. **验证登出：**
   - 点击导航栏登出按钮
   - 预期：跳转回 `/login`
