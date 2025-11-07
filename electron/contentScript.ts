// We no longer need the '/// <reference ... />' lines
// because electron/tsconfig.json now includes the "dom" lib.

console.log('[ContentScript] Injected successfully.');

(function () {
  let localPeerConnection: RTCPeerConnection | null = null;
  let localAudioSender: RTCRtpSender | null = null;
  let originalUserTrack: MediaStreamTrack | null = null;
  let audioContext: AudioContext | null = null;

  // Use a class to extend the original RTCPeerConnection
  class PatchedRTCPeerConnection extends window.RTCPeerConnection {
    constructor(config?: RTCConfiguration) {
      console.log('[ContentScript] PatchedRTCPeerConnection constructor called.');
      super(config); // Call the original constructor
      if (!audioContext) {
        audioContext = new AudioContext();
      }
    }

    // Override the addTrack method
    addTrack(track: MediaStreamTrack, ...streams: MediaStream[]) {
      if (track.kind === 'audio' && !localPeerConnection) {
        console.log('[ContentScript] Found RTCPeerConnection and user audio track.');
        localPeerConnection = this; // 'this' is the new pc instance
        
        setTimeout(() => {
          // Add explicit type 'RTCRtpSender' to 's' to fix implicit any
          localAudioSender = this.getSenders().find((s: RTCRtpSender) => s.track === track) || null;
          originalUserTrack = track;
          console.log('[ContentScript] Stored original audio sender and track.');
        }, 1000); 
      }
      // Call the original (super) method
      return super.addTrack(track, ...streams);
    }
  }

  // Now, overwrite the window property with our patched class
  window.RTCPeerConnection = PatchedRTCPeerConnection;


  // --- Bot Audio Playback Function ---
  const playBotAudio = async (audioData: ArrayBuffer) => {
    if (!localAudioSender || !originalUserTrack) {
      console.error('[ContentScript] No audio sender or original track found. Cannot play bot audio.');
      return;
    }
    if (!audioContext) {
      console.error('[ContentScript] AudioContext not initialized.');
      audioContext = new AudioContext();
    }

    try {
      const audioBuffer = await audioContext.decodeAudioData(audioData);
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      const botAudioTrack = destination.stream.getAudioTracks()[0];
      
      console.log('[ContentScript] Swapping to bot audio track...');
      await localAudioSender.replaceTrack(botAudioTrack);
      
      source.start();

      source.onended = () => {
        console.log('[ContentScript] Bot audio finished. Restoring user mic...');
        if (localAudioSender && originalUserTrack) {
          localAudioSender.replaceTrack(originalUserTrack);
        }
        botAudioTrack.stop();
        source.disconnect();
        destination.disconnect();
      };
    } catch (error) {
      console.error('[ContentScript] Error playing bot audio:', error);
      if (localAudioSender && originalUserTrack) {
        localAudioSender.replaceTrack(originalUserTrack);
      }
    }
  };

  // --- Listen for events from preload ---
  if (window.meetingAPI && typeof window.meetingAPI.onBotSpeak === 'function') {
    window.meetingAPI.onBotSpeak((audioData: ArrayBuffer) => {
      console.log('[ContentScript] Received bot-speak event with audio data.');
      playBotAudio(audioData);
    });
    console.log('[ContentScript] Attached to window.meetingAPI.onBotSpeak');
  } else {
    console.error('[ContentScript] window.meetingAPI is not available!');
  }
})();

// We need to declare this for TypeScript since it's defined in meetingPreload.ts
declare global {
  interface Window {
    meetingAPI: {
      onBotSpeak: (callback: (audioData: ArrayBuffer) => void) => () => void;
    };
  }
}

export {}; // Keep this to ensure it's treated as a module