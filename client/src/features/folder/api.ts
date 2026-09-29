import api from '@/lib/api';

export async function ensureFolderDirectory(
  workspaceId: string,
  directory: string,
): Promise<string | undefined> {
  const segments = directory.split('/').filter(Boolean);

  if (segments.length === 0) return undefined;

  const response = await api.post(`/workspaces/${workspaceId}/folders/ensure`, {
    segments,
  });

  return response.data.folderId as string;
}
