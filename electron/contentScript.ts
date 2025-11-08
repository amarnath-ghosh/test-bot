// electron/contentScript.ts

console.log('[ContentScript] Injected successfully.');

(function () {
  let localPeerConnection: RTCPeerConnection | null = null;
  let localAudioSender: RTCRtpSender | null = null;
  let originalUserTrack: MediaStreamTrack | null = null;

  class PatchedRTCPeerConnection extends window.RTCPeerConnection {
    constructor(config?: RTCConfiguration) {
      console.log('[ContentScript] PatchedRTCPeerConnection constructor called.');
      super(config);
    }

    addTrack(track: MediaStreamTrack, ...streams: MediaStream[]) {
      // MODIFIED: Always update when we see a new audio track.
      // This ensures we always have the *latest active* track.
      if (track.kind === 'audio') {
        console.log('[ContentScript] Found an audio track. Updating references...');
        localPeerConnection = this; // Store this peer connection
        
        // We must wait for the track to be added to the senders list.
        // We use a brief timeout to allow the browser to update.
        setTimeout(() => {
          const sender = this.getSenders().find((s: RTCRtpSender) => s.track === track);
          
          if (sender) {
            localAudioSender = sender;
            originalUserTrack = track;
            console.log('[ContentScript] Stored/Updated audio sender and original track.');
          } else {
            console.warn('[ContentScript] Could not find sender for the new audio track.');
          }
        }, 100); // 100ms should be enough
      }
      // Call the original (super) method
      return super.addTrack(track, ...streams);
    }
  }

  window.RTCPeerConnection = PatchedRTCPeerConnection;

  // --- Bot Audio Playback Function (NEW VERSION) ---
  const playBotAudio = async (pcmData: Float32Array) => {
    console.log('[ContentScript-Debug] 1. playBotAudio START (with PCM data)');
    
    if (!localAudioSender || !originalUserTrack) {
      console.error('[ContentScript-Debug] 1-ERROR. No audio sender or original track. Aborting.');
      return;
    }
    
    if (!pcmData || pcmData.length === 0) {
      console.error('[ContentScript-Debug] 1-ERROR. Received empty PCM data. Aborting.');
      return;
    }

    let audioContext: AudioContext | null = null;
    let source: AudioBufferSourceNode | null = null;
    let destination: MediaStreamAudioDestinationNode | null = null;

    try {
      // 1. Create AudioContext at the correct sample rate
      console.log('[ContentScript-Debug] 2. Creating new AudioContext at 24000Hz...');
      audioContext = new AudioContext({ sampleRate: 24000 });
      console.log(`[ContentScript-Debug] 3. AudioContext created. State: ${audioContext.state}`);
      
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
        console.log(`[ContentScript-Debug] 5. AudioContext resumed. State: ${audioContext.state}`);
      }

      // 2. Create a blank AudioBuffer
      const frameCount = pcmData.length;
      console.log(`[ContentScript-Debug] 6. Creating blank AudioBuffer for ${frameCount} frames...`);
      const audioBuffer = audioContext.createBuffer(1, frameCount, 24000);

      // 3. Copy our received PCM data into the buffer
      console.log('[ContentScript-Debug] 7. Copying PCM data into AudioBuffer...');
      audioBuffer.copyToChannel(new Float32Array(pcmData), 0);
      console.log('[ContentScript-Debug] 8. PCM data copied.');

      // 4. Create source and destination
      source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      
      const botAudioTrack = destination.stream.getAudioTracks()[0];
      console.log('[ContentScript-Debug] 9. Bot audio track created from buffer.');

      // 5. Set up onended handler
      source.onended = () => {
        console.log('[ContentScript-Debug] 12. [onended] Bot audio finished. Restoring user mic...');
        if (localAudioSender && originalUserTrack) {
          localAudioSender.replaceTrack(originalUserTrack)
            .then(() => console.log('[ContentScript-Debug] 13. [onended] User mic restored.'))
            .catch(err => console.error('[ContentScript-Debug] 13-ERROR. [onended] Failed to restore user mic:', err));
        }
        // Cleanup
        botAudioTrack.stop();
        source?.disconnect();
        destination?.disconnect();
        audioContext?.close().catch(e => console.error('[ContentScript-Debug] 14. [onended] Error closing AudioContext', e));
      };
      console.log('[ContentScript-Debug] 9a. onended handler attached.');

      // 6. Swap track and play
      console.log('[ContentScript-Debug] 10. Swapping to bot audio track...');
      await localAudioSender.replaceTrack(botAudioTrack);
      console.log('[ContentScript-Debug] 11. Track swapped. Starting playback...');
      source.start();

    } catch (error) {
      console.error('[ContentScript-Debug] 99-ERROR. CRITICAL FAILURE in playBotAudio:', error);
      if (localAudioSender && originalUserTrack) {
        localAudioSender.replaceTrack(originalUserTrack);
      }
      source?.disconnect();
      destination?.disconnect();
      audioContext?.close().catch(e => console.error('[ContentScript-Debug] 99-ERROR. Error closing AudioContext', e));
    }
  };

  // --- Listen for events from preload ---
  if (window.meetingAPI && typeof window.meetingAPI.onBotSpeak === 'function') {
    window.meetingAPI.onBotSpeak((pcmData: Float32Array) => {
      console.log('[ContentScript] Received bot-speak event with PCM data.');
      playBotAudio(pcmData);
    });
    console.log('[ContentScript] Attached to window.meetingAPI.onBotSpeak');
  } else {
    console.error('[ContentScript] window.meetingAPI is not available!');
  }
})();