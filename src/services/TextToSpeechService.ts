import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Types
export interface TTSOptions {
    provider?: 'elevenlabs' | 'openai';
    voiceId?: string; // ElevenLabs voice ID or OpenAI voice name
    stability?: number; // ElevenLabs only
    similarityBoost?: number; // ElevenLabs only
    model?: string; // e.g., 'eleven_multilingual_v2' or 'tts-1-hd'
}

export interface TTSResult {
    audioUrl: string; // Local path or remote URL
    duration?: number; // Duration in seconds
    mimeType: string;
}

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";
const OPENAI_API_URL = "https://api.openai.com/v1";

export const textToSpeechService = {

    async generateSpeech(text: string, options: TTSOptions = {}): Promise<TTSResult> {
        const provider = options.provider || 'elevenlabs';

        if (provider === 'elevenlabs') {
            return this.generateElevenLabs(text, options);
        } else {
            return this.generateOpenAI(text, options);
        }
    },

    async generateElevenLabs(text: string, options: TTSOptions): Promise<TTSResult> {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) throw new Error("ELEVENLABS_API_KEY is missing");

        const voiceId = options.voiceId || "21m00Tcm4TlvDq8ikWAM"; // Default 'Rachel'
        const model = options.model || "eleven_multilingual_v2";

        const response = await fetch(`${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': apiKey
            },
            body: JSON.stringify({
                text,
                model_id: model,
                voice_settings: {
                    stability: options.stability || 0.5,
                    similarity_boost: options.similarityBoost || 0.75
                }
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`ElevenLabs Error: ${(error as any).detail?.message || response.statusText}`);
        }

        return this.saveAudioBuffer(await response.arrayBuffer(), 'mp3');
    },

    async generateOpenAI(text: string, options: TTSOptions): Promise<TTSResult> {
        const apiKey = process.env.OPENAI_API_KEY; // Assuming user might have this too, or we fallback
        if (!apiKey) throw new Error("OPENAI_API_KEY is missing");

        const response = await fetch(`${OPENAI_API_URL}/audio/speech`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: options.model || "tts-1-hd",
                input: text,
                voice: options.voiceId || "alloy"
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI TTS Error: ${response.statusText}`);
        }

        return this.saveAudioBuffer(await response.arrayBuffer(), 'mp3');
    },

    async saveAudioBuffer(buffer: ArrayBuffer, extension: string): Promise<TTSResult> {
        const fileName = `${uuidv4()}.${extension}`;
        // Save to a public directory so frontend can access it if needed, 
        // or a temp dir for processing. 
        // For now, saving to 'public/temp' in backend.
        const uploadDir = path.join(process.cwd(), 'public', 'temp');

        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const filePath = path.join(uploadDir, fileName);
        fs.writeFileSync(filePath, Buffer.from(buffer));

        // Return a relative URL or absolute path depending on need. 
        // Returning absolute path for internal processing, and we can convert to URL later.
        return {
            audioUrl: filePath,
            mimeType: `audio/${extension}`
        };
    }
};
