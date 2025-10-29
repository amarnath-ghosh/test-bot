"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const isDev = process.env.NODE_ENV === 'development';
class ElectronApp {
    constructor() {
        this.windows = {
            mainWindow: null,
            meetingWindow: null
        };
        this.initialize();
    }
    async initialize() {
        await electron_1.app.whenReady();
        this.createMainWindow();
        this.setupIpcHandlers();
        this.setupEventHandlers();
    }
    createMainWindow() {
        this.windows.mainWindow = new electron_1.BrowserWindow({
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
        }
        else {
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
    createMeetingWindow(meetingUrl) {
        return new Promise((resolve, reject) => {
            try {
                this.windows.meetingWindow = new electron_1.BrowserWindow({
                    width: 1024,
                    height: 768,
                    parent: this.windows.mainWindow,
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
                    resolve(this.windows.meetingWindow.webContents.id);
                });
                this.windows.meetingWindow.on('closed', () => {
                    this.windows.meetingWindow = null;
                });
                this.windows.meetingWindow.on('page-title-updated', (event, title) => {
                    console.log('Meeting page title:', title);
                });
            }
            catch (error) {
                reject(error);
            }
        });
    }
    setupIpcHandlers() {
        electron_1.ipcMain.handle('join-meeting', async (event, url) => {
            try {
                if (!this.isValidMeetingUrl(url)) {
                    throw new Error('Invalid meeting URL');
                }
                const webContentsId = await this.createMeetingWindow(url);
                return { success: true, webContentsId };
            }
            catch (error) {
                console.error('Error joining meeting:', error);
                return { success: false };
            }
        });
        electron_1.ipcMain.handle('get-sources', async () => {
            try {
                const sources = await electron_1.desktopCapturer.getSources({
                    types: ['window', 'screen'],
                    thumbnailSize: { width: 150, height: 150 },
                    fetchWindowIcons: true
                });
                return sources;
            }
            catch (error) {
                console.error('Error getting desktop sources:', error);
                return [];
            }
        });
        electron_1.ipcMain.handle('close-meeting', async () => {
            try {
                if (this.windows.meetingWindow) {
                    this.windows.meetingWindow.close();
                    this.windows.meetingWindow = null;
                }
                return { success: true };
            }
            catch (error) {
                console.error('Error closing meeting:', error);
                return { success: false };
            }
        });
    }
    setupEventHandlers() {
        electron_1.app.on('activate', () => {
            if (electron_1.BrowserWindow.getAllWindows().length === 0) {
                this.createMainWindow();
            }
        });
        electron_1.app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') {
                electron_1.app.quit();
            }
        });
        electron_1.app.on('before-quit', () => {
            if (this.windows.meetingWindow) {
                this.windows.meetingWindow.close();
            }
        });
    }
    isValidMeetingUrl(url) {
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
        }
        catch {
            return false;
        }
    }
}
new ElectronApp();
