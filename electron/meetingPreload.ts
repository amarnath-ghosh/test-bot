import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Expose a minimal API for the content script to listen for the bot's audio
contextBridge.exposeInMainWorld('meetingAPI', {
  /**
   * Listens for the 'bot-speak' event from the main process and passes
   * the audio data (ArrayBuffer) to the callback.
   */
  onBotSpeak: (callback: (audioData: ArrayBuffer) => void) => {
    const subscription = (event: IpcRendererEvent, audioData: ArrayBuffer) => 
      callback(audioData);
    
    ipcRenderer.on('bot-speak', subscription);
    
    // Return a function to remove the listener
    return () => {
      ipcRenderer.removeListener('bot-speak', subscription);
    };
  },
});