import { app, BrowserWindow, ipcMain, desktopCapturer, DesktopCapturerSource, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import { WindowManager } from './types';

const isDev = process.env.NODE_ENV === 'development';

class ElectronApp {
  private windows: WindowManager = {
    mainWindow: null,
    meetingWindow: null
  };

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    await app.whenReady();
    this.createMainWindow();
    this.setupIpcHandlers();
    this.setupEventHandlers();
  }

  private createMainWindow(): void {
    this.windows.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        webSecurity: true,
        allowRunningInsecureContent: false
      },
      titleBarStyle: 'default',
      show: false
    });

    // Load the app - THIS IS THE FIX
    if (isDev) {
      this.windows.mainWindow.loadURL('http://localhost:3000');
      this.windows.mainWindow.webContents.openDevTools();
    } else {
      // Fixed path for production
      this.windows.mainWindow.loadFile(path.join(__dirname, '../../out/index.html'));
    }

    this.windows.mainWindow.once('ready-to-show', () => {
      this.windows.mainWindow?.show();
    });

    this.windows.mainWindow.on('closed', () => {
      this.windows.mainWindow = null;
    });
  }

  private createMeetingWindow(meetingUrl: string): Promise<number> {
    return new Promise((resolve, reject) => {
      try {
        this.windows.meetingWindow = new BrowserWindow({
          width: 1024,
          height: 768,
          parent: this.windows.mainWindow!,
          modal: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: true,
            allowRunningInsecureContent: false
          },
          titleBarStyle: 'default',
          show: false
        });

        this.windows.meetingWindow.loadURL(meetingUrl);

        this.windows.meetingWindow.once('ready-to-show', () => {
          this.windows.meetingWindow?.show();
          resolve(this.windows.meetingWindow!.webContents.id);
        });

        this.windows.meetingWindow.on('closed', () => {
          this.windows.meetingWindow = null;
        });

        this.windows.meetingWindow.on('page-title-updated', (event, title) => {
          console.log('Meeting page title:', title);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  private setupIpcHandlers(): void {
    ipcMain.handle('join-meeting', async (event: IpcMainInvokeEvent, url: string) => {
      try {
        if (!this.isValidMeetingUrl(url)) {
          throw new Error('Invalid meeting URL');
        }
        
        const webContentsId = await this.createMeetingWindow(url);
        return { success: true, webContentsId };
      } catch (error) {
        console.error('Error joining meeting:', error);
        return { success: false };
      }
    });

    ipcMain.handle('get-sources', async (): Promise<DesktopCapturerSource[]> => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['window', 'screen'],
          thumbnailSize: { width: 150, height: 150 },
          fetchWindowIcons: true
        });
        return sources;
      } catch (error) {
        console.error('Error getting desktop sources:', error);
        return [];
      }
    });

    ipcMain.handle('close-meeting', async (): Promise<{ success: boolean }> => {
      try {
        if (this.windows.meetingWindow) {
          this.windows.meetingWindow.close();
          this.windows.meetingWindow = null;
        }
        return { success: true };
      } catch (error) {
        console.error('Error closing meeting:', error);
        return { success: false };
      }
    });
  }

  private setupEventHandlers(): void {
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createMainWindow();
      }
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('before-quit', () => {
      if (this.windows.meetingWindow) {
        this.windows.meetingWindow.close();
      }
    });
  }

  private isValidMeetingUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const validDomains = [
        'meet.google.com',
        'zoom.us',
        'teams.microsoft.com',
        'webex.com',
        'gotomeeting.com'
      ];
      
      return validDomains.some(domain => urlObj.hostname.includes(domain));
    } catch {
      return false;
    }
  }
}

new ElectronApp();
