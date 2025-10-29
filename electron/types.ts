import { BrowserWindow, DesktopCapturerSource } from 'electron';

export interface ElectronMainAPI {
  createMeetingWindow: (url: string) => Promise<number>;
  getDesktopSources: () => Promise<DesktopCapturerSource[]>;
  closeMeetingWindow: () => Promise<void>;
}

export interface WindowManager {
  mainWindow: BrowserWindow | null;
  meetingWindow: BrowserWindow | null;
}

export interface IPCHandlers {
  'join-meeting': (url: string) => Promise<{ success: boolean; webContentsId?: number }>;
  'get-sources': () => Promise<DesktopCapturerSource[]>;
  'close-meeting': () => Promise<{ success: boolean }>;
  'send-transcript': (data: any) => void;
}
