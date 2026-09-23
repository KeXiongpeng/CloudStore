'use client';

import { useEffect, useRef, useState } from 'react';
import { useUploadQueue } from './store';
import { runUploadItem } from './runner';

const STATUS_LABEL: Record<string, string> = {
  hashing: '\u8ba1\u7b97\u54c8\u5e0c',
  creating: '\u521b\u5efa\u4f1a\u8bdd',
  instant: '\u79d2\u4f20',
  uploading: '\u4e0a\u4f20\u4e2d',
  merging: '\u5408\u5e76\u4e2d',
  completed: '\u5df2\u5b8c\u6210',
  canceled: '\u5df2\u53d6\u6d88',
  failed: '\u5931\u8d25',
};

export function UploadQueuePanel() {
  const items = useUploadQueue((state) => state.items);
  const clearCompleted = useUploadQueue((state) => state.clearCompleted);
  const [notification, setNotification] = useState<string | null>(null);
  const completedIdsRef = useRef<Set<string>>(
    new Set(items.filter((item) => item.status === 'completed').map((item) => item.id)),
  );

  useEffect(() => {
    const newlyCompleted = items.filter(
      (item) => item.status === 'completed' && !completedIdsRef.current.has(item.id),
    );

    if (newlyCompleted.length > 0) {
      completedIdsRef.current = new Set([
        ...completedIdsRef.current,
        ...newlyCompleted.map((item) => item.id),
      ]);
      setNotification(`${newlyCompleted[0].file.name} \u4e0a\u4f20\u6210\u529f`);
      const timer = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [items]);

  return (
    <>
      {notification && (
        <div className="fixed right-4 top-4 z-50 rounded-lg bg-emerald-500 px-4 py-3 text-sm font-medium text-white shadow-lg">
          {notification}
        </div>
      )}
      <section className="rounded-xl border p-4 dark:border-neutral-700">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">&#19978;&#20256;&#38431;&#21015;</h2>
          <button
            type="button"
            onClick={clearCompleted}
            className="text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-100"
          >
            &#28165;&#29702;&#24050;&#23436;&#25104;
          </button>
        </div>

        {items.length === 0 && (
          <p className="text-sm text-neutral-500">
            &#26242;&#26080;&#19978;&#20256;&#20219;&#21153;
          </p>
        )}

        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border p-3 dark:border-neutral-700">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.file.name}</p>
                  <p className="text-xs text-neutral-500">
                    {STATUS_LABEL[item.status]} &middot; {item.progress}%
                  </p>
                </div>
                <div className="flex gap-2">
                  {item.status === 'failed' && (
                    <button
                      type="button"
                      className="text-xs text-blue-600"
                      onClick={() => {
                        runUploadItem(item.id).catch(() => undefined);
                      }}
                    >
                      &#37325;&#35797;
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{ width: `${item.progress}%` }}
                />
              </div>
              {item.error && <p className="mt-1 text-xs text-red-500">{item.error}</p>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
