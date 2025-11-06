import { app, BrowserWindow, ipcMain, desktopCapturer, DesktopCapturerSource, IpcMainInvokeEvent, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { WindowManager } from './types';
import * as dotenv from 'dotenv';
import { createClient } from '@deepgram/sdk';

// Load .env file from the project root
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });

// Initialize Deepgram client in the main process
const deepgramApiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;
const deepgram = deepgramApiKey ? createClient(deepgramApiKey) : null;

if (!deepgram) {
  console.warn('DEEPGRAM_API_KEY not found. TTS in the meeting will be disabled.');
}

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
      // Only apply strict CSP to the main UI window
      if (details.webContentsId === this.windows.mainWindow?.webContents.id) {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              isDev
                ? `default-src 'self' ${devUrl} 'unsafe-inline' 'unsafe-eval'; script-src 'self' ${devUrl} 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ${devUrl} wss://api.deepgram.com accounts.google.com https://generativelanguage.googleapis.com https://api.deepgram.com; style-src 'self' ${devUrl} 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; media-src 'self' blob:;`
                : "default-src 'self'; script-src 'self'; connect-src 'self' wss://api.deepgram.com accounts.google.com https://generativelanguage.googleapis.com https://api.deepgram.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; media-src 'self' blob:;"
            ]
          }
        });
      } else {
        // For meeting window or other windows, do not modify headers
        callback({ responseHeaders: details.responseHeaders });
      }
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

    // --- MODIFIED: Handle text-to-speech requests using Deepgram ---
    ipcMain.on('bot-text-to-speak', async (event, text: string) => {
      // 1. Ensure the message is from the main UI window
      if (event.sender !== this.windows.mainWindow?.webContents) {
        return;
      }

      console.log('[Main] Received text to speak:', text.substring(0, 50) + '...');
      
      if (!deepgram) {
        console.error('[Main] Cannot speak. Deepgram client is not initialized.');
        return;
      }

      try {
        // 2. Generate audio here in the main process
        const audioData = await this.getDeepgramTTS(text);
        console.log(`[Main] Generated audio data: ${audioData.byteLength} bytes`);
        
        // 3. Send the audio data DIRECTLY to the meeting window
        if (this.windows.meetingWindow) {
          this.windows.meetingWindow.webContents.send('bot-speak', audioData);
          console.log('[Main] Relayed audio data to meeting window.');
        } else {
          console.warn('[Main] No meeting window to send audio to.');
        }
      } catch (error) {
        console.error('[Main] Error in TTS generation/relay pipeline:', error);
      }
    });
  }

  private async getDeepgramTTS(text: string): Promise<ArrayBuffer> {
    if (!deepgram) {
      console.error('[Main] Deepgram API key not set. Cannot generate TTS.');
      throw new Error('Deepgram API key not configured for main process.');
    }

    try {
      // Use the Deepgram SDK to get speech
      const response = await deepgram.speak.request(
        { text },
        { model: 'aura-asteria-en' }
      );
      
      // Get the stream and convert it to Uint8Array
      const stream = await response.getStream();
      if (!stream) {
        throw new Error('Failed to get audio stream from Deepgram');
      }

      // Read the stream into a Uint8Array
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }

      // Combine all chunks into a single Uint8Array
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      
      // Convert to ArrayBuffer
      return result.buffer;

    } catch (error) {
      console.error('[Main] Deepgram TTS request failed:', error);
      throw error;
    }
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
        'gotomeeting.com',
        'bigbluebutton.org' 
      ];
      
      return validDomains.some(domain => urlObj.hostname.includes(domain));
    } catch {
      return false;
    }
  }
}

new ElectronApp();