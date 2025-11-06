// amarnath-ghosh/test-bot/test-bot-8f5b51de8b94d0a0054e52db17bbcbccb9c0849e/electron/contentScript.ts

console.log('[ContentScript] Injected successfully (v4 - Syntax Fix)');

(function () {
  let localPeerConnection: RTCPeerConnection | null = null;
  let originalUserTrack: MediaStreamTrack | null = null;
  let audioContext: AudioContext | null = null;

  // Use a class to extend the original RTCPeerConnection
  class PatchedRTCPeerConnection extends window.RTCPeerConnection {
    constructor(config?: RTCConfiguration) {
      console.log('[ContentScript] PatchedRTCPeerConnection constructor called.');
      super(config); // Call the original constructor
      if (!audioContext) {
        audioContext = new AudioContext();
        console.log('[ContentScript] AudioContext created.');
      }
    }

    // Override the addTrack method
    addTrack(track: MediaStreamTrack, ...streams: MediaStream[]) {
      if (track.kind === 'audio' && !localPeerConnection) {
        console.log('[ContentScript] User audio track detected. Storing track and PeerConnection.');
        
        localPeerConnection = this; // 'this' is the new pc instance
        originalUserTrack = track;
      }
      // Call the original (super) method
      return super.addTrack(track, ...streams);
    }
  }

  // Now, overwrite the window property with our patched class
  window.RTCPeerConnection = PatchedRTCPeerConnection;


  // --- Bot Audio Playback Function ---
  const playBotAudio = async (audioData: ArrayBuffer) => {
    // Check for audio context
    if (!audioContext) {
      console.error('[ContentScript] AudioContext not initialized. This should not happen.');
      audioContext = new AudioContext();
    }
    
    // Check if we have found the user's PC and Track yet
    if (!localPeerConnection || !originalUserTrack) {
      console.error('[ContentScript] No PeerConnection or original track found. Cannot play bot audio.');
      return;
    }

    // --- FIND SENDER JUST-IN-TIME (with the fix) ---
    const localAudioSender = localPeerConnection.getSenders().find(
      (s: RTCRtpSender) => s.track === originalUserTrack
    );

    if (!localAudioSender) {
      console.error('[ContentScript] Could not find audio sender. Cannot play bot audio.');
      return;
    }

    console.log('[ContentScript] Audio sender and track are ready.');

    try {
      // Browsers often suspend AudioContext until user interaction.
      // We must resume it before trying to decode or play audio.
      if (audioContext.state === 'suspended') {
        console.log('[ContentScript] AudioContext is suspended, attempting to resume...');
        await audioContext.resume();
        console.log('[ContentScript] AudioContext resumed. State:', audioContext.state);
      }

      console.log('[ContentScript] Decoding audio data...');
      const audioBuffer = await audioContext.decodeAudioData(audioData);
      
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      const botAudioTrack = destination.stream.getAudioTracks()[0];
      
      console.log('[ContentScript] Swapping to bot audio track...');
      await localAudioSender.replaceTrack(botAudioTrack);
      
      source.start();
      console.log('[ContentScript] Bot audio playback started.');

      source.onended = () => {
        console.log('[ContentScript] Bot audio finished. Restoring user mic...');
        if (localAudioSender && originalUserTrack) {
          localAudioSender.replaceTrack(originalUserTrack)
            .then(() => console.log('[ContentScript] User mic restored.'))
            .catch(err => console.error('[ContentScript] Error restoring user mic:', err));
        }
        botAudioTrack.stop();
        source.disconnect();
        destination.disconnect();
      };
    } catch (error) {
      console.error('[ContentScript] Error playing bot audio:', error);
      // Failsafe: Try to restore the original track if something went wrong
      if (localAudioSender && originalUserTrack) {
        localAudioSender.replaceTrack(originalUserTrack)
          .catch(err => console.error('[ContentScript] Failsafe restore mic error:', err));
      }
    }
  };

  // --- Listen for events from preload ---
  if (window.meetingAPI && typeof window.meetingAPI.onBotSpeak === 'function') {
    window.meetingAPI.onBotSpeak((audioData: ArrayBuffer) => {
      console.log(`[ContentScript] Received 'bot-speak' event with ${audioData.byteLength} bytes.`);
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