"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Define the API that will be exposed to the renderer
const electronAPI = {
    joinMeeting: (url) => electron_1.ipcRenderer.invoke('join-meeting', url),
    getSources: () => electron_1.ipcRenderer.invoke('get-sources'),
    closeMeeting: () => electron_1.ipcRenderer.invoke('close-meeting'),
    onTranscriptUpdate: (callback) => {
        const subscription = (event, data) => callback(data);
        electron_1.ipcRenderer.on('transcript-update', subscription);
    },
    removeTranscriptListener: () => {
        electron_1.ipcRenderer.removeAllListeners('transcript-update');
    }
};
// Expose the API to the renderer process
electron_1.contextBridge.exposeInMainWorld('electronAPI', electronAPI);
