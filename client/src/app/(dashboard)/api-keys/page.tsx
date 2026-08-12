'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';

interface ApiKey {
  id: string;
  name: string;
  lastUsed: string | null;
  createdAt: string;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchKeys = async () => {
    const response = await api.get('/keys');
    setKeys(response.data);
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setLoading(true);
    try {
      const response = await api.post('/keys', { name: newKeyName });
      setCreatedKey(response.data.key);
      setNewKeyName('');
      fetchKeys();
    } catch (error) {
      console.error('创建密钥失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (keyId: string) => {
    if (!confirm('确定要删除此 API Key 吗？')) return;
    await api.delete(`/keys/${keyId}`);
    fetchKeys();
  };

  const sharexConfig = createdKey
    ? JSON.stringify({
        Name: 'CloudStore',
        RequestType: 'PUT',
        RequestURL: `${window.location.origin}/api/files/presign/api-key`,
        Headers: {
          'x-api-key': createdKey,
        },
        FileFormName: 'file',
        URL: `${window.location.origin}/api/files/callback`,
        Arguments: {
          filename: '{filename}',
          contentType: '{filetype}',
          fileSize: '{filesize}',
          storageKey: '{response.data.storageKey}',
        },
        RequestMethod: 'POST',
      }, null, 2)
    : null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">API 密钥</h1>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        管理你的 API 密钥，用于 ShareX 等工具直接上传文件。
      </p>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">创建新密钥</h2>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="密钥名称（如 ShareX）"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <button
            onClick={handleCreate}
            disabled={loading || !newKeyName.trim()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            创建
          </button>
        </div>
      </div>

      {createdKey && (
        <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            新密钥已生成（仅显示一次，请立即保存）
          </p>
          <div className="mt-2 rounded bg-white p-3 font-mono text-sm dark:bg-gray-900">
            {createdKey}
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(createdKey)}
            className="mt-2 rounded bg-yellow-600 px-3 py-1 text-sm text-white hover:bg-yellow-700"
          >
            复制密钥
          </button>

          {sharexConfig && (
            <div className="mt-4">
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">ShareX 配置</p>
              <button
                onClick={() => navigator.clipboard.writeText(sharexConfig)}
                className="mt-1 rounded bg-gray-100 px-3 py-1 text-sm dark:bg-gray-800 dark:text-gray-300"
              >
                复制 ShareX JSON 配置
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-6">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">已有密钥</h2>
        {keys.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">暂无 API 密钥</p>
        ) : (
          <div className="mt-3 space-y-2">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{key.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    创建于 {new Date(key.createdAt).toLocaleDateString('zh-CN')}
                    {key.lastUsed && ` · 最后使用 ${new Date(key.lastUsed).toLocaleDateString('zh-CN')}`}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(key.id)}
                  className="text-sm text-red-600 hover:text-red-700 dark:text-red-400"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
