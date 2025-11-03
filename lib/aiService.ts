import {
  GoogleGenerativeAI,
  GenerationConfig,
  ChatSession,
} from '@google/generative-ai';
import { TranscriptSegment } from './types';

// Define the structure for conversation history
export interface ChatMessage {
  role: 'user' | 'model';
  parts: [{ text: string }];
}

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: string = 'gemini-1.5-flash';
  private chat: ChatSession | null = null;
  private generationConfig: GenerationConfig = {
    temperature: 0.7,
    topK: 1,
    topP: 1,
    maxOutputTokens: 2048,
  };

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.startChat();
  }

  // Initializes a new chat session with a system prompt
  public startChat(): void {
    const generativeModel = this.genAI.getGenerativeModel({
      model: this.model,
    });

    this.chat = generativeModel.startChat({
      generationConfig: this.generationConfig,
      history: [
        {
          role: 'user',
          parts: [
            {
              text: 'You are an AI assistant in a live meeting. Your name is "Bot". You are listening to a real-time transcript. When a user asks you a question (e.g., "Hey Bot, can you summarize?"), you will respond based on the transcript provided. Keep your answers concise and professional. Here is the meeting context:',
            },
          ],
        },
        {
          role: 'model',
          parts: [
            {
              text: 'Understood. I am ready to assist. I will wait for a user to address me and then respond based on the provided transcript context.',
            },
          ],
        },
      ],
    });
  }

  // Formats the transcript into a string for the model
  private formatTranscript(transcript: TranscriptSegment[]): string {
    return transcript
      .map(segment => `${segment.speaker}: ${segment.text}`)
      .join('\n');
  }

  // Generates a response from Gemini
  public async generateResponse(
    question: string,
    transcriptContext: TranscriptSegment[]
  ): Promise<string> {
    if (!this.chat) {
      throw new Error('Chat session is not initialized');
    }

    // Create the prompt
    const fullTranscript = this.formatTranscript(transcriptContext);
    const prompt = `
      ---
      MEETING TRANSCRIPT (SO FAR):
      ${fullTranscript}
      ---
      
      USER QUESTION:
      "${question}"
      ---

      Based on the transcript, please answer the user's question.
    `;

    try {
      const result = await this.chat.sendMessage(prompt);
      const response = result.response;
      return response.text();
    } catch (error) {
      // THIS IS THE MODIFIED BLOCK
      console.error('Error generating Gemini response:', error);
      // Now you will see the *real* error in your console
      return "I'm sorry, I encountered an error while processing that request.";
    }
  }

  // (rest of the file is the same as before)
  // ...
}