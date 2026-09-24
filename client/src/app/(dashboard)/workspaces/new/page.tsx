'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { getApiErrorMessage } from '@/lib/errors';
import { useCreateWorkspace } from '@/features/workspace/api';
import { useWorkspaceStore } from '@/features/workspace/store';

const schema = z.object({ name: z.string().min(2, '名称至少 2 个字符').max(128, '名称过长') });
type FormValues = z.infer<typeof schema>;

export default function NewWorkspacePage() {
  const router = useRouter();
  const setCurrentWorkspace = useWorkspaceStore((state) => state.setCurrentWorkspace);
  const createWorkspace = useCreateWorkspace();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });

  return (
    <main className="mx-auto max-w-md">
      <h1 className="mb-6 text-2xl font-bold">创建工作区</h1>
      <form
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-950"
        onSubmit={handleSubmit(async (values) => {
          try {
            const workspace = await createWorkspace.mutateAsync(values);
            setCurrentWorkspace(workspace);
            router.push('/dashboard');
          } catch (error) {
            window.alert(getApiErrorMessage(error, '创建工作区失败'));
          }
        })}
      >
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="name">
            工作区名称
          </label>
          <input
            id="name"
            {...register('name')}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          />
          {errors.name && <p className="mt-1 text-sm text-red-500">{errors.name.message}</p>}
        </div>
        <button
          type="submit"
          disabled={createWorkspace.isPending}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {createWorkspace.isPending ? '创建中...' : '创建'}
        </button>
      </form>
    </main>
  );
}
