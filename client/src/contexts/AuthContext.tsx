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
