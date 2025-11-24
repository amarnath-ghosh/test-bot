import { app, BrowserWindow, ipcMain, desktopCapturer, DesktopCapturerSource, IpcMainInvokeEvent, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
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
              // --- MODIFIED TO BE MORE PERMISSIVE ---
              ? `default-src 'self' ${devUrl} https: wss: 'unsafe-inline' 'unsafe-eval' blob: data:; script-src 'self' ${devUrl} 'unsafe-inline' 'unsafe-eval' blob:; connect-src 'self' ${devUrl} https: wss: blob:; style-src 'self' ${devUrl} 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' blob: data:;`
              // --- MODIFIED TO BE MORE PERMISSIVE ---
              : "default-src 'self' https: wss: 'unsafe-inline' 'unsafe-eval' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; connect-src 'self' https: wss: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' blob: data:;"
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
        preload: path.join(__dirname, 'preload.js'), // <-- This is for the MAIN window
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
            preload: path.join(__dirname, 'meetingPreload.js'), // <-- MODIFIED: Use the NEW preload script
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

        // --- NEW: Inject the content script after the page loads ---
        this.windows.meetingWindow.webContents.on('did-finish-load', () => {
          console.log('Meeting window finished loading. Injecting content script...');
          const contentScriptPath = path.join(__dirname, 'contentScript.js');
          
          fs.readFile(contentScriptPath, 'utf-8', (err, script) => {
            if (err) {
              console.error('Failed to read content script:', err);
              return;
            }
            this.windows.meetingWindow?.webContents.executeJavaScript(script)
              .then(() => console.log('Content script injected successfully.'))
              .catch(err => console.error('Failed to inject content script:', err));
          });
        });
        // --- End of NEW ---

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

    // --- NEW: IPC handler to relay audio from UI to meeting window ---
    ipcMain.on('bot-speak-data', (event, pcmData: Float32Array) => {
      // Check if the message is from the mainWindow
      if (event.sender === this.windows.mainWindow?.webContents) {
        // Relay the message to the meetingWindow
        if (this.windows.meetingWindow) {
          this.windows.meetingWindow.webContents.send('bot-speak', pcmData);
        }
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
  return true; // DANGEROUS: Allows bot to join any site
}
}

new ElectronApp();