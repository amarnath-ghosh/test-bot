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

  constructor(config: SpeechConfig = {}) {
    this.synth = window.speechSynthesis;
    this.config = {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      voice: '',
      ...config
    };
    
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
      isDefault: voice.default
    }));
  }

  private determineGender(voiceName: string): 'male' | 'female' | 'unknown' {
    const femaleIndicators = ['female', 'woman', 'girl', 'lady', 'samantha', 'susan', 'karen', 'anna', 'emma'];
    const maleIndicators = ['male', 'man', 'boy', 'gentleman', 'daniel', 'alex', 'tom', 'david', 'james'];
    
    const lowerName = voiceName.toLowerCase();
    
    if (femaleIndicators.some(indicator => lowerName.includes(indicator))) {
      return 'female';
    }
    if (maleIndicators.some(indicator => lowerName.includes(indicator))) {
      return 'male';
    }
    
    return 'unknown';
  }

  async speak(text: string, onEnd?: () => void, onError?: (error: Error) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      // Cancel any ongoing speech
      this.stop();

      this.currentUtterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance.rate = this.config.rate;
      this.currentUtterance.pitch = this.config.pitch;
      this.currentUtterance.volume = this.config.volume;

      // Set voice if specified
      if (this.config.voice) {
        const selectedVoice = this.availableVoices.find(voice => 
          voice.name === this.config.voice || voice.lang.includes(this.config.voice)
        );
        if (selectedVoice) {
          this.currentUtterance.voice = selectedVoice;
        }
      }

      this.currentUtterance.onend = () => {
        if (onEnd) onEnd();
        resolve();
      };

      this.currentUtterance.onerror = (event) => {
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

  async createAudioTrack(text: string): Promise<MediaStreamTrack> {
    // For creating synthetic audio tracks that can be used with WebRTC
    // This is a simplified implementation - in production, you'd want to use
    // a service like ElevenLabs, Google TTS, or AWS Polly
    
    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    
    // Create a simple tone as placeholder
    // In production, you'd generate actual speech audio here
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    
    oscillator.connect(gainNode);
    gainNode.connect(destination);
    
    oscillator.start();
    
    // Stop after estimated speech duration (rough calculation)
    const estimatedDuration = text.length * 0.1; // 100ms per character
    setTimeout(() => {
      oscillator.stop();
    }, estimatedDuration * 1000);
    
    return destination.stream.getAudioTracks()[0];
  }
}
