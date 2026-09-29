import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Workspace } from './types';

interface WorkspaceState {
  currentWorkspace: Workspace | null;
  setCurrentWorkspace: (workspace: Workspace | null) => void;
  resetWorkspace: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      currentWorkspace: null,
      setCurrentWorkspace: (workspace) => set({ currentWorkspace: workspace }),
      resetWorkspace: () => set({ currentWorkspace: null }),
    }),
    { name: 'clouddrive.current-workspace' },
  ),
);
