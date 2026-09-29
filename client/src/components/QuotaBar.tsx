'use client';

interface QuotaBarProps {
  used: number;
  limit: number;
}

export default function QuotaBar({ used, limit }: QuotaBarProps) {
  const percent = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const barColor = percent >= 90 ? 'bg-red-500' : percent >= 70 ? 'bg-yellow-500' : 'bg-blue-500';

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600 dark:text-gray-400">
          {formatSize(used)} / {formatSize(limit)}
        </span>
        <span className="font-medium text-gray-900 dark:text-white">{percent.toFixed(1)}%</span>
      </div>
      <div className="mt-2 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className={`h-2 rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
