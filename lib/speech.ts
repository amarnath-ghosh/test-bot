// amarnath-ghosh/test-bot/test-bot-8f5b51de8b94d0a0054e52db17bbcbccb9c0849e/lib/speech.ts

import { AudioCaptureSettings } from './types'; // Assuming types.ts is in the same directory

export interface SpeechConfig {
  rate?: number;
  pitch?: number;
  volume?: number;
  voice?: string; // Model name, e.g., "aura-asteria-en"
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
  
  // --- REMOVED THIS LINE ---
  // private deepgramApiKey: string | undefined;

  // AudioContext for routing bot audio
  private audioContext: AudioContext | null = null;

  constructor(config: SpeechConfig = {}) {
    this.synth = window.speechSynthesis;
    this.config = {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      voice: 'aura-asteria-en', // Default to a Deepgram Aura voice
      ...config,
    };
    
    // --- REMOVED THIS LINE ---
    // this.deepgramApiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;

    // Lazy load audio context
    if (typeof window !== 'undefined' && !this.audioContext) {
      this.audioContext = new AudioContext();
    }

    this.initializeVoices();
  }

  private initializeVoices(): void {
    // ... (this function is unchanged)
    // This is for local speech
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
    // ... (this function is unchanged)
    return this.availableVoices.map(voice => ({
      name: voice.name,
      lang: voice.lang,
      gender: this.determineGender(voice.name.toLowerCase()),
      isDefault: voice.default,
    }));
  }

  private determineGender(voiceName: string): 'male' | 'female' | 'unknown' {
    // ... (this function is unchanged)
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
    // ... (this function is unchanged)
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
    // ... (this function is unchanged)
    this.synth.cancel();
    this.currentUtterance = null;
  }

  pause(): void {
    // ... (this function is unchanged)
    if (this.synth.speaking) {
      this.synth.pause();
    }
  }

  resume(): void {
    // ... (this function is unchanged)
    if (this.synth.paused) {
      this.synth.resume();
    }
  }

  isSpeaking(): boolean {
    // ... (this function is unchanged)
    return this.synth.speaking;
  }

  isPaused(): boolean {
    // ... (this function is unchanged)
    return this.synth.paused;
  }

  updateConfig(newConfig: Partial<SpeechConfig>): void {
    // ... (this function is unchanged)
    this.config = { ...this.config, ...newConfig };
  }

  // --- THIS ENTIRE FUNCTION IS REMOVED ---
  /*
  async createAudioData(text: string): Promise<ArrayBuffer> {
    // ... (function body removed) ...
  }
  */
}