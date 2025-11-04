import { app, BrowserWindow, ipcMain, desktopCapturer, DesktopCapturerSource, IpcMainInvokeEvent, session } from 'electron';
import * as path from 'path';
import { WindowManager } from './types';

const isDev = process.env.NODE_ENV === 'development';
const port = process.env.PORT || 3000; 
const devUrl = `http://localhost:${port}`;
const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';

class ElectronApp {
  private windows: WindowManager = {
    mainWindow: null,
    meetingWindow: null
  };

  constructor() {
    this.initialize();
  }

  private setupSecurityPolicy(): void {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            isDev
              // --- THIS LINE IS MODIFIED ---
              ? `default-src 'self' ${devUrl} 'unsafe-inline' 'unsafe-eval'; script-src 'self' ${devUrl} 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ${devUrl} wss://api.deepgram.com accounts.google.com https://generativelanguage.googleapis.com; style-src 'self' ${devUrl} 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:`
              // --- THIS LINE IS MODIFIED ---
              : "default-src 'self'; script-src 'self'; connect-src 'self' wss://api.deepgram.com accounts.google.com https://generativelanguage.googleapis.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:"
          ]
        }
      });
    });
  }

  private async initialize(): Promise<void> {
    await app.whenReady();
    this.setupSecurityPolicy(); 
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

    // Load the app
    if (isDev) {
      this.windows.mainWindow.loadURL(devUrl);
      this.windows.mainWindow.webContents.openDevTools();
    } else {
      this.windows.mainWindow.loadFile(path.join(__dirname, '../../../out/index.html'));
      this.windows.mainWindow.webContents.openDevTools();
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
        
        this.windows.meetingWindow.webContents.userAgent = CHROME_USER_AGENT;
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