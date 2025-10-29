import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { ElectronAPI } from '../lib/types';

// Define the API that will be exposed to the renderer
const electronAPI: ElectronAPI = {
  joinMeeting: (url: string) => ipcRenderer.invoke('join-meeting', url),
  
  getSources: () => ipcRenderer.invoke('get-sources'),
  
  closeMeeting: () => ipcRenderer.invoke('close-meeting'),
  
  onTranscriptUpdate: (callback: (data: any) => void) => {
    const subscription = (event: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('transcript-update', subscription);
  },
  
  removeTranscriptListener: () => {
    ipcRenderer.removeAllListeners('transcript-update');
  }
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
