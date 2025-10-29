import { ElectronAPI } from '@/lib/types';

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
