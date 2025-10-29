'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TranscriptionService } from '@/lib/transcription';
import { SpeechService } from '@/lib/speech';
import { AudioManager } from '@/lib/audioManager';
import { AnalyticsService } from '@/lib/analytics';
import { AppState, TranscriptSegment, AudioCaptureSettings } from '@/lib/types';

const DEFAULT_AUDIO_SETTINGS: AudioCaptureSettings = {
  sampleRate: 44100,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};

export default function MeetingBotApp() {
  // State management
  const [appState, setAppState] = useState<AppState>({
    meetingUrl: '',
    isInMeeting: false,
    isRecording: false,
    currentSession: null,
    status: 'Ready to join meeting',
    error: null
  });

  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [botResponses, setBotResponses] = useState<string[]>([]);

  // Service instances
  const transcriptionServiceRef = useRef<TranscriptionService | null>(null);
  const speechServiceRef = useRef<SpeechService | null>(null);
  const audioManagerRef = useRef<AudioManager | null>(null);
  const analyticsServiceRef = useRef<AnalyticsService | null>(null);

  // Media references
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // Initialize services
  useEffect(() => {
    const initializeServices = async (): Promise<void> => {
      try {
        // Initialize analytics service
        analyticsServiceRef.current = new AnalyticsService();

        // Initialize speech service
        speechServiceRef.current = new SpeechService({
          rate: 1.0,
          pitch: 1.0,
          volume: 0.8
        });

        // Initialize audio manager
        audioManagerRef.current = new AudioManager();

        setAppState(prev => ({ ...prev, status: 'Services initialized' }));
      } catch (error) {
        console.error('Failed to initialize services:', error);
        setAppState(prev => ({ 
          ...prev, 
          error: `Failed to initialize services: ${error}`,
          status: 'Initialization failed'
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
    // Stop all services and clean up resources
    if (transcriptionServiceRef.current) {
      transcriptionServiceRef.current.disconnect();
    }

    if (speechServiceRef.current) {
      speechServiceRef.current.stop();
    }

    if (audioManagerRef.current) {
      audioManagerRef.current.cleanup();
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
    }
  }, []);

  const handleJoinMeeting = async (): Promise<void> => {
    if (!appState.meetingUrl.trim()) {
      setAppState(prev => ({ ...prev, error: 'Please enter a valid meeting URL' }));
      return;
    }

    try {
      setAppState(prev => ({ ...prev, status: 'Joining meeting...', error: null }));

      // Use Electron API if available
      if (window.electronAPI) {
        const result = await window.electronAPI.joinMeeting(appState.meetingUrl);
        if (result.success) {
          setAppState(prev => ({
            ...prev,
            isInMeeting: true,
            status: 'Joined meeting. Click "Start Analysis" to begin recording and analysis.'
          }));

          // Start analytics session
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
        setAppState(prev => ({
          ...prev,
          isInMeeting: true,
          status: 'Meeting opened in new tab. Click "Start Analysis" when ready.'
        }));
      }
    } catch (error) {
      console.error('Error joining meeting:', error);
      setAppState(prev => ({
        ...prev,
        error: `Failed to join meeting: ${error}`,
        status: 'Join failed'
      }));
    }
  };

  const handleStartAnalysis = async (): Promise<void> => {
  try {
    setAppState(prev => ({ ...prev, status: 'Initializing...', error: null }));

    // Check if Deepgram is configured
    const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;
    
    if (apiKey && apiKey !== 'your_deepgram_api_key_here') {
      console.log('Deepgram API key found, initializing transcription service...');
      transcriptionServiceRef.current = new TranscriptionService({ apiKey });

      // Connect to transcription service
      await transcriptionServiceRef.current.connect(
        handleTranscriptUpdate,
        handleTranscriptionError
      );
      console.log('✓ Connected to Deepgram');
    } else {
      console.warn('⚠ No Deepgram API key configured. Running in mock mode.');
      setAppState(prev => ({ 
        ...prev, 
        status: 'Running in demo mode (no real transcription). Add Deepgram API key for real-time transcription.' 
      }));
    }

    // Start audio capture
    await startAudioCapture();

    setAppState(prev => ({
      ...prev,
      isRecording: true,
      status: apiKey ? 'Recording and analyzing with Deepgram...' : 'Recording with mock transcription...'
    }));

  } catch (error) {
    console.error('Error starting analysis:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    setAppState(prev => ({
      ...prev,
      error: `Failed to start analysis: ${errorMessage}`,
      status: 'Analysis failed to start',
      isRecording: false
    }));
  }
};

  const startAudioCapture = async (): Promise<void> => {
  try {
    setAppState(prev => ({ ...prev, status: 'Requesting screen/audio capture permissions...' }));

    // Request screen/tab capture with audio
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'monitor',
      },
      audio: true
    });

    console.log('Display stream obtained');
    console.log('Video tracks:', displayStream.getVideoTracks().length);
    console.log('Audio tracks:', displayStream.getAudioTracks().length);

    // Check if we got audio
    const hasAudio = displayStream.getAudioTracks().length > 0;
    
    if (!hasAudio) {
      console.warn('No audio track in display stream. Will try to get microphone audio instead.');
      
      // Try to get microphone audio as fallback
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: DEFAULT_AUDIO_SETTINGS.echoCancellation,
            noiseSuppression: DEFAULT_AUDIO_SETTINGS.noiseSuppression,
            autoGainControl: DEFAULT_AUDIO_SETTINGS.autoGainControl
          } 
        });
        
        // Combine display video with mic audio
        const combinedStream = new MediaStream([
          ...displayStream.getVideoTracks(),
          ...micStream.getAudioTracks()
        ]);
        
        audioStreamRef.current = combinedStream;
        console.log('Using combined stream (display video + microphone audio)');
      } catch (micError) {
        console.error('Could not get microphone:', micError);
        throw new Error('No audio available. Please enable "Share audio" when selecting screen, or grant microphone permission.');
      }
    } else {
      audioStreamRef.current = displayStream;
      console.log('Using display stream with audio');
    }

    const stream = audioStreamRef.current;
    const audioTracks = stream.getAudioTracks();
    
    console.log('Final audio tracks:', audioTracks.length);
    audioTracks.forEach((track, index) => {
      console.log(`Audio track ${index}:`, {
        kind: track.kind,
        label: track.label,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState
      });
    });

    // Create an audio-only stream for MediaRecorder
    const audioOnlyStream = new MediaStream(audioTracks);

    // Detect supported MIME types
    const supportedTypes = [
      'audio/webm',
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/wav',
      'audio/mp4',
      'audio/mpeg'
    ];

    let selectedType = '';
    for (const type of supportedTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        selectedType = type;
        console.log('✓ Supported MIME type:', type);
        break;
      } else {
        console.log('✗ Not supported:', type);
      }
    }

    if (!selectedType) {
      console.warn('No explicitly supported type found, using browser default');
    }

    // Create MediaRecorder with the audio-only stream
    const options: MediaRecorderOptions = selectedType ? { mimeType: selectedType } : {};
    const mediaRecorder = new MediaRecorder(audioOnlyStream, options);

    console.log('MediaRecorder created with:', {
      mimeType: mediaRecorder.mimeType,
      state: mediaRecorder.state,
      audioBitsPerSecond: mediaRecorder.audioBitsPerSecond
    });

    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = async (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        console.log('Audio data received:', event.data.size, 'bytes');
        await processAudioChunk(event.data);
      }
    };

    mediaRecorder.onerror = (event: Event) => {
      console.error('MediaRecorder error:', event);
      setAppState(prev => ({
        ...prev,
        error: 'Recording error occurred. Please try again.',
        status: 'Recording failed'
      }));
    };

    mediaRecorder.onstart = () => {
      console.log('✓ MediaRecorder started successfully');
      setAppState(prev => ({ 
        ...prev, 
        status: 'Recording and analyzing meeting audio...' 
      }));
    };

    mediaRecorder.onstop = () => {
      console.log('MediaRecorder stopped');
    };

    // Start recording with 1-second chunks
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
    console.log('📦 Processing audio chunk:', {
      size: audioBlob.size,
      type: audioBlob.type
    });

    // Check if we have a transcription service
    if (transcriptionServiceRef.current?.isWebSocketConnected()) {
      // Convert blob to ArrayBuffer and send to transcription service
      const arrayBuffer = await audioBlob.arrayBuffer();
      transcriptionServiceRef.current.sendAudio(arrayBuffer);
      console.log('✓ Sent to Deepgram');
    } else {
      // Simulate transcription for testing
      if (Math.random() > 0.9) { // 10% chance to add mock transcript
        const mockTexts = [
          'Hello everyone, welcome to the meeting.',
          'Can everyone hear me okay?',
          'Let\'s start with the agenda.',
          'Does anyone have any questions?',
          'Thank you all for joining today.'
        ];
        
        const mockSegment: TranscriptSegment = {
          speaker: `Speaker ${Math.floor(Math.random() * 3)}`,
          speakerIndex: Math.floor(Math.random() * 3),
          text: mockTexts[Math.floor(Math.random() * mockTexts.length)],
          startTime: Date.now(),
          endTime: Date.now() + 2000,
          confidence: 0.85 + Math.random() * 0.15
        };
        
        console.log('🎤 Mock transcript:', mockSegment.text);
        handleTranscriptUpdate(mockSegment);
      }
    }

  } catch (error) {
    console.error('Error processing audio chunk:', error);
  }
};

  const handleTranscriptUpdate = useCallback((segment: TranscriptSegment): void => {
    console.log('Received transcript:', segment);

    // Update transcript state
    setTranscript(prev => {
      // Replace or append segment based on confidence/finality
      const existingIndex = prev.findIndex(s => 
        s.speakerIndex === segment.speakerIndex && 
        Math.abs(s.startTime - segment.startTime) < 1000
      );

      if (existingIndex !== -1) {
        const updated = [...prev];
        updated[existingIndex] = segment;
        return updated;
      } else {
        return [...prev, segment];
      }
    });

    // Add to analytics
    if (analyticsServiceRef.current) {
      analyticsServiceRef.current.addTranscriptSegment(segment);
      
      // Analyze sentiment
      const sentiment = analyticsServiceRef.current.analyzeSentiment(segment.text);
      analyticsServiceRef.current.updateParticipantSentiment(`unknown_${segment.speakerIndex}`, sentiment);
    }

    // Check if the bot is being addressed
    checkForBotMention(segment);

  }, []);

  const handleTranscriptionError = useCallback((error: Error): void => {
    console.error('Transcription error:', error);
    setAppState(prev => ({
      ...prev,
      error: `Transcription error: ${error.message}`,
      status: 'Transcription failed'
    }));
  }, []);

  const checkForBotMention = (segment: TranscriptSegment): void => {
    const text = segment.text.toLowerCase();
    const botTriggers = ['bot', 'assistant', 'ai', 'hey bot', 'bot please'];
    
    if (botTriggers.some(trigger => text.includes(trigger))) {
      handleBotResponse(segment);
    }
  };

  const handleBotResponse = async (segment: TranscriptSegment): Promise<void> => {
    try {
      // Generate a contextual response based on the meeting transcript
      const response = generateBotResponse(segment, transcript);
      
      setBotResponses(prev => [...prev, response]);

      // Speak the response if speech service is available
      if (speechServiceRef.current) {
        await speechServiceRef.current.speak(
          response,
          () => console.log('Bot finished speaking'),
          (error) => console.error('Speech error:', error)
        );
      }

    } catch (error) {
      console.error('Error generating bot response:', error);
    }
  };

  const generateBotResponse = (segment: TranscriptSegment, context: TranscriptSegment[]): string => {
    // Simple response generation - in production, use an AI service
    const text = segment.text.toLowerCase();
    
    if (text.includes('summary') || text.includes('summarize')) {
      const participantCount = new Set(context.map(s => s.speakerIndex)).size;
      const duration = context.length > 0 ? 
        Math.round((Date.now() - context[0].startTime) / 60000) : 0;
      return `So far we have ${participantCount} participants in this ${duration} minute meeting. The main topics discussed include the recent transcript segments.`;
    }
    
    if (text.includes('who') || text.includes('participants')) {
      const speakers = new Set(context.map(s => s.speaker)).size;
      return `I can identify ${speakers} different speakers in this meeting so far.`;
    }
    
    if (text.includes('time') || text.includes('duration')) {
      const duration = context.length > 0 ? 
        Math.round((Date.now() - context[0].startTime) / 60000) : 0;
      return `This meeting has been running for approximately ${duration} minutes.`;
    }
    
    return "I'm listening to the meeting and taking notes. How can I help you?";
  };

  const handleStopAnalysis = (): void => {
    try {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }

      // Stop audio stream
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
      }

      // Disconnect transcription
      if (transcriptionServiceRef.current) {
        transcriptionServiceRef.current.disconnect();
      }

      setAppState(prev => ({
        ...prev,
        isRecording: false,
        status: 'Analysis stopped'
      }));

    } catch (error) {
      console.error('Error stopping analysis:', error);
      setAppState(prev => ({
        ...prev,
        error: `Failed to stop analysis: ${error}`
      }));
    }
  };

  const handleLeaveMeeting = async (): Promise<void> => {
    try {
      // Stop analysis first
      handleStopAnalysis();

      // Close meeting window if using Electron
      if (window.electronAPI) {
        await window.electronAPI.closeMeeting();
      }

      // End analytics session and export data
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

      setAppState(prev => ({
        ...prev,
        isInMeeting: false,
        currentSession: null,
        status: 'Left meeting and exported data'
      }));

    } catch (error) {
      console.error('Error leaving meeting:', error);
      setAppState(prev => ({
        ...prev,
        error: `Failed to leave meeting: ${error}`
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
                onChange={(e) => setAppState(prev => ({ ...prev, meetingUrl: e.target.value }))}
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
                        {formatTimestamp(segment.startTime)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-800">{segment.text}</p>
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
                      <span className="text-sm font-medium text-blue-800">Bot</span>
                      <span className="text-xs text-blue-600 ml-2">
                        {new Date().toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm text-blue-800">{response}</p>
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
                  {transcript.length > 0 ? 
                    Math.round((Date.now() - transcript[0].startTime) / 60000) : 0}m
                </p>
              </div>
              
              <div className="bg-purple-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-purple-800">Words</h3>
                <p className="text-2xl font-bold text-purple-900">
                  {transcript.reduce((sum, s) => sum + s.text.split(' ').length, 0)}
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
