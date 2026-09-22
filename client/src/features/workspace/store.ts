import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Workspace } from './types';

interface WorkspaceState {
  currentWorkspace: Workspace | null;
  setCurrentWorkspace: (workspace: Workspace | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      currentWorkspace: null,
      setCurrentWorkspace: (workspace) => set({ currentWorkspace: workspace }),
    }),
    { name: 'clouddrive.current-workspace' },
  ),
);
