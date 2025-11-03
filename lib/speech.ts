import { AudioCaptureSettings } from './types'; // Assuming types.ts is in the same directory

export interface SpeechConfig {
  rate?: number;
  pitch?: number;
  volume?: number;
  voice?: string;
}

export interface VoiceInfo {
  name: string;
  lang: string;
  gender: 'male' | 'female' | 'unknown';
  isDefault: boolean;
}

export class SpeechService {
  private synth: SpeechSynthesis;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private config: Required<SpeechConfig>;
  private availableVoices: SpeechSynthesisVoice[] = [];

  // AudioContext for routing bot audio
  private audioContext: AudioContext | null = null;

  constructor(config: SpeechConfig = {}) {
    this.synth = window.speechSynthesis;
    this.config = {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      voice: '',
      ...config,
    };

    // Lazy load audio context
    if (typeof window !== 'undefined' && !this.audioContext) {
      this.audioContext = new AudioContext();
    }

    this.initializeVoices();
  }

  private initializeVoices(): void {
    // Voices might not be immediately available
    const updateVoices = () => {
      this.availableVoices = this.synth.getVoices();
    };

    updateVoices();

    // Listen for voices changed event (some browsers need this)
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = updateVoices;
    }
  }

  getAvailableVoices(): VoiceInfo[] {
    return this.availableVoices.map(voice => ({
      name: voice.name,
      lang: voice.lang,
      gender: this.determineGender(voice.name.toLowerCase()),
      isDefault: voice.default,
    }));
  }

  private determineGender(voiceName: string): 'male' | 'female' | 'unknown' {
    const femaleIndicators = [
      'female', 'woman', 'girl', 'lady', 'samantha', 'susan', 'karen', 'anna', 'emma',
    ];
    const maleIndicators = [
      'male', 'man', 'boy', 'gentleman', 'daniel', 'alex', 'tom', 'david', 'james',
    ];

    const lowerName = voiceName.toLowerCase();

    if (femaleIndicators.some(indicator => lowerName.includes(indicator))) {
      return 'female';
    }
    if (maleIndicators.some(indicator => lowerName.includes(indicator))) {
      return 'male';
    }

    return 'unknown';
  }

  /**
   * Speaks audio LOCALLY for the user to hear.
   * This audio does NOT go to the meeting.
   */
  async speak(
    text: string,
    onEnd?: () => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Cancel any ongoing speech
      this.stop();

      this.currentUtterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance.rate = this.config.rate;
      this.currentUtterance.pitch = this.config.pitch;
      this.currentUtterance.volume = this.config.volume;

      // Set voice if specified
      if (this.config.voice) {
        const selectedVoice = this.availableVoices.find(
          voice =>
            voice.name === this.config.voice ||
            voice.lang.includes(this.config.voice)
        );
        if (selectedVoice) {
          this.currentUtterance.voice = selectedVoice;
        }
      }

      this.currentUtterance.onend = () => {
        if (onEnd) onEnd();
        resolve();
      };

      this.currentUtterance.onerror = event => {
        const error = new Error(`Speech synthesis error: ${event.error}`);
        if (onError) onError(error);
        reject(error);
      };

      this.synth.speak(this.currentUtterance);
    });
  }

  stop(): void {
    this.synth.cancel();
    this.currentUtterance = null;
  }

  pause(): void {
    if (this.synth.speaking) {
      this.synth.pause();
    }
  }

  resume(): void {
    if (this.synth.paused) {
      this.synth.resume();
    }
  }

  isSpeaking(): boolean {
    return this.synth.speaking;
  }

  isPaused(): boolean {
    return this.synth.paused;
  }

  updateConfig(newConfig: Partial<SpeechConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Creates a new MediaStreamTrack containing the bot's speech.
   * This track is intended to be sent TO THE MEETING.
   */
  async createAudioTrack(text: string): Promise<MediaStreamTrack> {
    if (!this.audioContext) {
      throw new Error('AudioContext is not initialized.');
    }

    // Ensure context is running (it's often suspended on page load)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    
    const audioContext = this.audioContext;
    const destination = audioContext.createMediaStreamDestination();

    // --- Placeholder: Generate a Tone ---
    // This is a placeholder to prove the track-swapping works.
    // To generate real speech, you would:
    // 1. Fetch an audio blob from a Cloud TTS API (e.g., Deepgram, Google).
    // 2. Decode it: const audioBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
    // 3. Create a source: const source = audioContext.createBufferSource(); source.buffer = audioBuffer;
    // 4. Connect source to destination: source.connect(destination);
    // 5. Start source: source.start(0);
    // 6. Listen for source.onended to stop the track.

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4 note
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);

    oscillator.connect(gainNode);
    gainNode.connect(destination);

    oscillator.start();

    // Stop after estimated speech duration (rough calculation)
    const estimatedDuration = text.length * 0.1; // 100ms per character
    const audioTrack = destination.stream.getAudioTracks()[0];

    setTimeout(() => {
      try {
        oscillator.stop();
        oscillator.disconnect();
        gainNode.disconnect();
        // Manually stop the track. This fires the 'onended' event
        // which app/page.tsx listens for to restore the user's mic.
        audioTrack.stop();
      } catch (e) {
        console.warn("Audio node cleanup error:", e);
      }
    }, estimatedDuration * 1000);

    return audioTrack;
  }
}