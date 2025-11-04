'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TranscriptionService } from '@/lib/transcription';
import { SpeechService } from '@/lib/speech';
import { AnalyticsService } from '@/lib/analytics';
import { GeminiService } from '@/lib/aiService'; 
import {
  AppState,
  TranscriptSegment,
  AudioCaptureSettings,
  DeepgramResponse,
  BotResponse,
  DesktopCapturerSource, // <-- MODIFIED: Import our own interface
} from '@/lib/types';

const DEFAULT_AUDIO_SETTINGS: AudioCaptureSettings = {
  sampleRate: 44100,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export default function MeetingBotApp() {
  // State management
  const [appState, setAppState] = useState<AppState>({
    meetingUrl: '',
    isInMeeting: false,
    isRecording: false,
    currentSession: null,
    status: 'Ready to join meeting',
    error: null,
  });

  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [botResponses, setBotResponses] = useState<BotResponse[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number>(0);

  // Service instances
  const transcriptionServiceRef = useRef<TranscriptionService | null>(null);
  const speechServiceRef = useRef<SpeechService | null>(null);
  const analyticsServiceRef = useRef<AnalyticsService | null>(null);
  const geminiServiceRef = useRef<GeminiService | null>(null);

  // Media references
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const desktopStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // Initialize services
  useEffect(() => {
    const initializeServices = async (): Promise<void> => {
      try {
        analyticsServiceRef.current = new AnalyticsService();
        speechServiceRef.current = new SpeechService({
          rate: 1.0,
          pitch: 1.0,
          volume: 0.8,
        });

        setAppState((prev: AppState) => ({ ...prev, status: 'Services initialized' }));
      } catch (error) {
        console.error('Failed to initialize services:', error);
        setAppState((prev: AppState) => ({
          ...prev,
          error: (error as Error).message,
          status: 'Initialization failed',
        }));
      }
    };

    initializeServices();

    // Cleanup on unmount
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = useCallback((): void => {
    if (transcriptionServiceRef.current) {
      transcriptionServiceRef.current.disconnect();
    }
    if (speechServiceRef.current) {
      speechServiceRef.current.stop();
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (desktopStreamRef.current) {
      desktopStreamRef.current.getTracks().forEach(track => track.stop());
      desktopStreamRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }
  }, []);

  const handleJoinMeeting = async (): Promise<void> => {
    if (!appState.meetingUrl.trim()) {
      setAppState((prev: AppState) => ({ ...prev, error: 'Please enter a valid meeting URL' }));
      return;
    }

    try {
      setAppState((prev: AppState) => ({ ...prev, status: 'Joining meeting...', error: null }));

      if (window.electronAPI) {
        const result = await window.electronAPI.joinMeeting(appState.meetingUrl);
        if (result.success) {
          setAppState((prev: AppState) => ({
            ...prev,
            isInMeeting: true,
            status: 'Joined meeting. Click "Start Analysis" to begin recording and analysis.',
          }));
          if (analyticsServiceRef.current) {
            const sessionId = `session_${Date.now()}`;
            analyticsServiceRef.current.startSession(sessionId, appState.meetingUrl);
          }
        } else {
          throw new Error('Failed to join meeting');
        }
      } else {
        // Fallback: open in new browser tab
        window.open(appState.meetingUrl, '_blank', 'width=1024,height=768');
        setAppState((prev: AppState) => ({
          ...prev,
          isInMeeting: true,
          status: 'Meeting opened in new tab. Click "Start Analysis" when ready.',
        }));
        if (analyticsServiceRef.current) {
          const sessionId = `session_${Date.now()}`;
          analyticsServiceRef.current.startSession(sessionId, appState.meetingUrl);
        }
      }
    } catch (error) {
      console.error('Error joining meeting:', error);
      setAppState((prev: AppState) => ({
        ...prev,
        error: (error as Error).message,
        status: 'Join failed',
      }));
    }
  };

  const handleStartAnalysis = async (): Promise<void> => {
    try {
      setAppState((prev: AppState) => ({ ...prev, status: 'Initializing...', error: null }));

      // Check if Deepgram is configured
      const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;

      if (apiKey && apiKey !== 'your_deepgram_api_key_here') {
        console.log('Deepgram API key found, initializing transcription service...');
        transcriptionServiceRef.current = new TranscriptionService({ apiKey });

        await transcriptionServiceRef.current.connect(
          handleTranscriptUpdate,
          handleTranscriptionError
        );
        console.log('✓ Connected to Deepgram');
      } else {
        console.warn('⚠ No Deepgram API key configured. Running in mock mode.');
        setAppState((prev: AppState) => ({
          ...prev,
          status:
            'Running in demo mode (no real transcription). Add Deepgram API key for real-time transcription.',
        }));
      }

      // Initialize Gemini Service
      const geminiApiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (geminiApiKey && geminiApiKey !== 'your_gemini_api_key_here') {
        geminiServiceRef.current = new GeminiService(geminiApiKey);
        console.log('✓ GeminiService initialized');
      } else {
        console.warn('⚠ No Gemini API key found. Bot responses will be disabled.');
      }

      // Start audio capture
      await startAudioCapture();
      
      setSessionStartTime(Date.now());

      setAppState((prev: AppState) => ({
        ...prev,
        isRecording: true,
        status: apiKey
          ? 'Recording and analyzing with Deepgram...'
          : 'Recording with mock transcription...',
      }));
    } catch (error) {
      console.error('Error starting analysis:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setAppState((prev: AppState) => ({
        ...prev,
        error: `Failed to start analysis: ${errorMessage}`,
        status: 'Analysis failed to start',
        isRecording: false,
      }));
    }
  };

  const startAudioCapture = async (): Promise<void> => {
    let transcriptionAudioStream: MediaStream;

    try {
      if (window.electronAPI) {
        // --- ELECTRON-SPECIFIC AUDIO CAPTURE ---
        console.log('Electron API found. Using desktopCapturer.');
        setAppState((prev: AppState) => ({ ...prev, status: 'Getting audio sources...' }));

        const sources = await window.electronAPI.getSources();
        // MODIFIED: Added explicit type for 'source'
        const entireScreenSource = sources.find((source: DesktopCapturerSource) => source.id.startsWith('screen:'));
        
        if (!entireScreenSource) {
          throw new Error("Could not find a screen to capture.");
        }

        console.log('Capturing source:', entireScreenSource.name);

        const constraints = {
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: entireScreenSource.id,
            },
          },
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: entireScreenSource.id,
            },
          },
        };
        // @ts-ignore
        const fullDesktopStream = await navigator.mediaDevices.getUserMedia(constraints);
        desktopStreamRef.current = fullDesktopStream;
        transcriptionAudioStream = new MediaStream(fullDesktopStream.getAudioTracks());
        
      } else {
        // --- BROWSER-BASED FALLBACK (getDisplayMedia) ---
        console.log('No Electron API found. Falling back to getDisplayMedia.');
        setAppState((prev: AppState) => ({ ...prev, status: 'Requesting permission. IMPORTANT: Please check "Share tab audio" or "Share system audio" to capture all participants.' }));
        
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });

        desktopStreamRef.current = displayStream;

        const hasAudio = displayStream.getAudioTracks().length > 0;
        if (!hasAudio) {
          throw new Error('No audio available. Please enable "Share audio" when selecting screen.');
        }
        transcriptionAudioStream = new MediaStream(displayStream.getAudioTracks());
      }
      
      audioStreamRef.current = transcriptionAudioStream;
      console.log('✓ Audio stream obtained for transcription.');
      
      // --- Start MediaRecorder ---
      const supportedTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/wav',
        'audio/mp4',
      ];

      let selectedType = '';
      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          selectedType = type;
          console.log(`✓ Supported MIME type found: ${type}`);
          break;
        }
      }

      if (!selectedType) {
        console.warn('No specific MIME type supported, using browser default.');
      }
      
      const options: MediaRecorderOptions = selectedType ? { mimeType: selectedType } : {};
      const mediaRecorder = new MediaRecorder(transcriptionAudioStream, options);
      console.log(`MediaRecorder initialized with type: ${mediaRecorder.mimeType || 'default'}`);
      
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = async (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          await processAudioChunk(event.data);
        }
      };

      mediaRecorder.onerror = (event: Event) => {
        console.error('MediaRecorder error:', event);
        setAppState((prev: AppState) => ({
          ...prev,
          error: 'Recording error occurred. Please try again.',
          status: 'Recording failed'
        }));
      };

      mediaRecorder.onstart = () => {
        console.log('✓ MediaRecorder started successfully');
        setAppState((prev: AppState) => ({ 
          ...prev, 
          status: 'Recording and analyzing meeting audio...' 
        }));
      };

      mediaRecorder.onstop = () => {
        console.log('MediaRecorder stopped');
        // If recording stops unexpectedly, try to restart it
        if (appState.isRecording) {
            console.warn("MediaRecorder stopped unexpectedly. Restarting capture...");
            startAudioCapture().catch(err => {
                console.error("Failed to restart audio capture:", err);
                setAppState((prev: AppState) => ({...prev, error: "Audio capture failed and could not be restarted."}));
            });
        }
      };

      mediaRecorder.start(1000);
      console.log('MediaRecorder.start() called');

    } catch (error) {
      console.error('Full error in startAudioCapture:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to start audio capture: ${errorMessage}`);
    }
  };


 const processAudioChunk = async (audioBlob: Blob): Promise<void> => {
    try {
      if (transcriptionServiceRef.current?.isWebSocketConnected()) {
        const arrayBuffer = await audioBlob.arrayBuffer();
        transcriptionServiceRef.current.sendAudio(arrayBuffer);
      } else if (!transcriptionServiceRef.current) {
        // Mock transcription logic
        if (Math.random() > 0.9) { 
          const mockTexts = [ 'Hello bot, can you summarize?', 'I have a question for the bot.' ];
          const mockSegment: TranscriptSegment = {
            speaker: `Speaker ${Math.floor(Math.random() * 2)}`,
            speakerIndex: Math.floor(Math.random() * 2),
            text: mockTexts[Math.floor(Math.random() * mockTexts.length)],
            startTime: (Date.now() - sessionStartTime) / 1000,
            endTime: (Date.now() - sessionStartTime) / 1000 + 2,
            confidence: 0.95,
            isFinal: true,
          };
          const mockData: DeepgramResponse = {
            is_final: true, speech_final: true,
            channel: { alternatives: [{ transcript: mockSegment.text, confidence: mockSegment.confidence, words: [] }] },
            metadata: { request_id: '', model_info: { name: 'mock', version: '1.0' } },
          };
          console.log('🎤 Mock transcript:', mockSegment.text);
          handleTranscriptUpdate(mockSegment, mockData);
        }
      }
    } catch (error) {
      console.error('Error processing audio chunk:', error);
    }
  };

  const handleTranscriptUpdate = useCallback(
    (segment: TranscriptSegment, data: DeepgramResponse): void => {
      console.log('Transcript:', segment.text, 'Is Final:', data.is_final);

      if (analyticsServiceRef.current) {
        analyticsServiceRef.current.addTranscriptSegment(segment);
        const sentiment = analyticsServiceRef.current.analyzeSentiment(segment.text);
        analyticsServiceRef.current.updateParticipantSentiment(
          `unknown_${segment.speakerIndex}`,
          sentiment
        );
      }

      setTranscript((prev: TranscriptSegment[]) => {
        const existingIndex = prev.findIndex(
          s => s.speakerIndex === segment.speakerIndex && !s.isFinal
        );

        if (data.is_final) {
          segment.isFinal = true;
          if (existingIndex !== -1) {
            const updated = [...prev];
            updated[existingIndex] = segment;
            return updated;
          } else {
            return [...prev, segment];
          }
        } else {
          if (existingIndex !== -1) {
            const updated = [...prev];
            updated[existingIndex] = segment;
            return updated;
          } else {
            return [...prev, segment];
          }
        }
      });

      if (data.is_final && segment.text.trim().length > 0) {
        checkForBotMention(segment);
      }
    },
    [sessionStartTime] 
  );

  const handleTranscriptionError = useCallback((error: Error): void => {
    console.error('Transcription error:', error);
    setAppState((prev: AppState) => ({
      ...prev,
      error: `Transcription error: ${error.message}`,
      status: 'Transcription failed',
    }));
  }, []);

  const checkForBotMention = (segment: TranscriptSegment): void => {
    const text = segment.text.toLowerCase();
    const botTriggers = ['bot', 'assistant', 'ai', 'hey bot', 'bot please', 'hello board', 'hello bob'];
    
    if (botTriggers.some(trigger => text.includes(trigger))) {
      handleBotResponse(segment);
    }
  };

  const handleBotResponse = async (segment: TranscriptSegment): Promise<void> => {
    if (!geminiServiceRef.current) {
      console.warn('Gemini service not initialized. Skipping bot response.');
      return;
    }
    
    // Feedback loop checks (these are good, keep them)
    if (segment.text.toLowerCase().includes("i'm sorry, i encountered an error")) {
        console.warn("Detected audio feedback loop. Ignoring.");
        return;
    }
    if (segment.text.toLowerCase().includes("gemini") || segment.text.toLowerCase().includes("flash")) {
        console.warn("Detected audio feedback loop of Gemini error. Ignoring.");
        return;
    }


    try {
      const question = segment.text;
      
      let currentTranscript: TranscriptSegment[] = [];
      setTranscript((prev: TranscriptSegment[]) => {
        currentTranscript = prev;
        return prev;
      });

      // Show "thinking" message
      const thinkingMessage: BotResponse = {
        speaker: 'Bot',
        text: '...',
        timestamp: Date.now(),
      };
      setBotResponses((prev: BotResponse[]) => [...prev, thinkingMessage]);

      // 1. Get text response from Gemini
      const responseText = await geminiServiceRef.current.generateResponse(
        question,
        currentTranscript
      );

      const newResponse: BotResponse = {
        speaker: 'Bot',
        text: responseText,
        timestamp: Date.now(),
      };
      
      // Update UI with final text
      setBotResponses((prev: BotResponse[]) => {
        const updated = [...prev];
        const lastResponse = updated[updated.length - 1];
        if (lastResponse && lastResponse.text === '...') {
          updated[updated.length - 1] = newResponse;
        } else {
          updated.push(newResponse);
        }
        return updated;
      });

      // --- NEW: Bot speaking logic ---
      if (speechServiceRef.current && window.electronAPI) {
        try {
            console.log("Generating bot audio data from text...");
            // 2. Get audio data from TTS service
            const audioData = await speechServiceRef.current.createAudioData(responseText);
            console.log("Bot audio data created (ArrayBuffer).");
            
            // 3. Send audio data to main process to be relayed to meeting window
            window.electronAPI.sendBotAudio(audioData);
            console.log("Sent bot audio data to main process.");

        } catch(audioError) {
             console.error("Failed to generate or send bot audio:", audioError);
        }
      } else {
        console.warn("Speech service or Electron API not available. Cannot speak.");
      }
      // --- END of NEW logic ---

    } catch (error) {
      console.error('Error in handleBotResponse:', error);
      setBotResponses((prev: BotResponse[]) => {
        const updated = [...prev];
        const lastResponse = updated[updated.length - 1];
        if (lastResponse && lastResponse.text === '...') {
            lastResponse.text = "Sorry, I had trouble responding.";
        }
        return updated;
      });
    }
  };

  const handleStopAnalysis = (): void => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (desktopStreamRef.current) {
        desktopStreamRef.current.getTracks().forEach(track => track.stop());
        desktopStreamRef.current = null;
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
        audioStreamRef.current = null;
      }
      if (transcriptionServiceRef.current) {
        transcriptionServiceRef.current.disconnect();
      }
      
      setSessionStartTime(0);

      setAppState((prev: AppState) => ({
        ...prev,
        isRecording: false,
        status: 'Analysis stopped'
      }));

    } catch (error) {
      console.error('Error stopping analysis:', error);
      setAppState((prev: AppState) => ({
        ...prev,
        error: (error as Error).message
      }));
    }
  };

  const handleLeaveMeeting = async (): Promise<void> => {
    try {
      handleStopAnalysis();

      if (window.electronAPI) {
        await window.electronAPI.closeMeeting();
      }

      if (analyticsServiceRef.current) {
        const sessionData = analyticsServiceRef.current.endSession();
        if (sessionData) {
          const filename = `meeting-${sessionData.id}-${new Date().toISOString().slice(0, 10)}`;
          analyticsServiceRef.current.downloadExport(filename, {
            format: 'json',
            includeTranscript: true,
            includeSentiment: true,
            includeWordTiming: false
          });
        }
      }

      setAppState((prev: AppState) => ({
        ...prev,
        isInMeeting: false,
        currentSession: null,
        status: 'Left meeting and exported data'
      }));

    } catch (error) {
      console.error('Error leaving meeting:', error);
      setAppState((prev: AppState) => ({
        ...prev,
        error: (error as Error).message
      }));
    }
  };

  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            AI Meeting Bot Assistant
          </h1>
          <p className="text-gray-600">
            Join meetings, analyze conversations, and provide intelligent assistance
          </p>
        </header>

        {/* Meeting Controls */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h2 className="text-2xl font-semibold mb-4 text-gray-800">
            Meeting Controls
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Meeting URL
              </label>
              <input
                type="url"
                value={appState.meetingUrl}
                onChange={(e) => setAppState((prev: AppState) => ({ ...prev, meetingUrl: e.target.value }))}
                placeholder="https://meet.google.com/xxx-xxxx-xxx"
                className="w-full px-4 py-3 border text-black border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                disabled={appState.isInMeeting}
              />
            </div>

            <div className="flex flex-wrap gap-3">
              {!appState.isInMeeting ? (
                <button
                  onClick={handleJoinMeeting}
                  disabled={!appState.meetingUrl.trim()}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  Join Meeting
                </button>
              ) : (
                <>
                  {!appState.isRecording ? (
                    <button
                      onClick={handleStartAnalysis}
                      className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                    >
                      Start Analysis
                    </button>
                  ) : (
                    <button
                      onClick={handleStopAnalysis}
                      className="px-6 py-3 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors font-medium"
                    >
                      Stop Analysis
                    </button>
                  )}
                  
                  <button
                    onClick={handleLeaveMeeting}
                    className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                  >
                    Leave Meeting
                  </button>
                </>
              )}
            </div>

            {/* Status Display */}
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">Status</p>
                  <p className={`text-sm ${appState.error ? 'text-red-600' : 'text-gray-600'}`}>
                    {appState.error || appState.status}
                  </p>
                </div>
                
                {appState.isRecording && (
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                    <span className="text-sm text-red-600 font-medium">Recording</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Live Transcript */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-semibold mb-4 text-gray-800">
              Live Transcript
            </h2>
            <div className="h-96 overflow-y-auto bg-gray-50 rounded-lg p-4 space-y-3">
              {transcript.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <p>No transcript available. Start analysis to begin transcription.</p>
                </div>
              ) : (
                transcript.map((segment, index) => (
                  <div key={index} className="border-b border-gray-200 pb-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-blue-600">
                        {segment.speaker}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(sessionStartTime + segment.startTime * 1000).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className={`text-sm text-gray-800 ${!segment.isFinal ? 'opacity-70' : ''}`}>
                      {segment.text}
                    </p>
                    <span className="text-xs text-gray-400">
                      Confidence: {(segment.confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Bot Responses */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-semibold mb-4 text-gray-800">
              Bot Responses
            </h2>
            <div className="h-96 overflow-y-auto bg-gray-50 rounded-lg p-4 space-y-3">
              {botResponses.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <p>No bot responses yet. Mention the bot in the meeting to get responses.</p>
                </div>
              ) : (
                botResponses.map((response, index) => (
                  <div key={index} className="bg-blue-100 rounded-lg p-3">
                    <div className="flex items-center mb-1">
                      <span className="text-sm font-medium text-blue-800">{response.speaker}</span>
                      <span className="text-xs text-blue-600 ml-2">
                        {formatTimestamp(response.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm text-blue-800" style={{ whiteSpace: 'pre-wrap' }}>{response.text}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Meeting Stats */}
        {appState.isInMeeting && (
          <div className="mt-6 bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-semibold mb-4 text-gray-800">
              Meeting Statistics
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-blue-800">Participants</h3>
                <p className="text-2xl font-bold text-blue-900">
                  {new Set(transcript.map(s => s.speakerIndex)).size}
                </p>
              </div>
              
              <div className="bg-green-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-green-800">Duration</h3>
                <p className="text-2xl font-bold text-green-900">
                  {sessionStartTime > 0 ? 
                    Math.round((Date.now() - sessionStartTime) / 60000) : 0}m
                </p>
              </div>
              
              <div className="bg-purple-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-purple-800">Words</h3>
                <p className="text-2xl font-bold text-purple-900">
                  {transcript.reduce((sum, s) => sum + (s.text ? s.text.split(' ').length : 0), 0)}
                </p>
              </div>
              
              <div className="bg-orange-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-orange-800">Responses</h3>
                <p className="text-2xl font-bold text-orange-900">
                  {botResponses.length}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}