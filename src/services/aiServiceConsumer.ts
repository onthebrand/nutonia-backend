import axios, { AxiosError } from 'axios';
// import { contentQueue } from './queueService'; // Removed circular dependency, or use type import

// --- Types matching the Microservice API Contract ---

export interface AIContentRequest {
    user_id: string;
    topic: string;
    style: string;
    level: string;
}

export interface AISource {
    title: string;
    url: string;
    snippet: string;
    reliability_score: number;
}

export interface AIContentResponse {
    content: string;
    sources: AISource[];
    validation_score: number;
    error?: string;
}

// --- Configuration ---

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8000';

// --- Service ---

export class AIServiceConsumer {

    /**
     * Calls the Python AI-Engine to validate sources and generate content.
     * This is the "Source of Truth" wrapper.
     */
    async generateValidatedContent(params: AIContentRequest): Promise<AIContentResponse> {
        try {
            console.log(`[AIService] Requesting content for topic: ${params.topic}`);

            const response = await axios.post<AIContentResponse>(
                `${AI_ENGINE_URL}/validate-and-generate`,
                params,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        // Add internal auth tokens here if needed
                        // 'X-Service-Key': process.env.AI_SERVICE_KEY 
                    },
                    timeout: 60000 // High timeout for GenAI operations
                }
            );

            return response.data;

        } catch (error) {
            const err = error as AxiosError;
            console.error('[AIService] Error calling AI Engine:', err.message);

            if (err.response) {
                // The request was made and the server responded with a status code
                // that falls out of the range of 2xx
                console.error('[AIService] Response data:', err.response.data);
            } else if (err.request) {
                // The request was made but no response was received
                return {
                    content: '',
                    sources: [],
                    validation_score: 0,
                    error: 'AI Engine unreachable. Please verify the service is running.'
                };
            }

            // Fallback for other errors
            return {
                content: '',
                sources: [],
                validation_score: 0,
                error: `Generation failed: ${err.message}`
            };
        }
    }

    /**
     * Health check to ensure microservice is up before starting queues or jobs.
     */
    async checkHealth(): Promise<boolean> {
        try {
            const res = await axios.get(`${AI_ENGINE_URL}/health`);
            return res.status === 200 && res.data.status === 'active';
        } catch (e) {
            return false;
        }
    }

    /**
     * Calls the Python AI-Engine to generate a video.
     */
    async generateVideo(prompt: string, model: string = 'veo-2.0-preview-0124'): Promise<any> {
        try {
            console.log(`[AIService] Requesting video for prompt: ${prompt}`);

            const response = await axios.post(
                `${AI_ENGINE_URL}/generate-video`,
                { prompt, model },
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    timeout: 120000 // High timeout for video generation
                }
            );

            return response.data;

        } catch (error) {
            const err = error as AxiosError;
            console.error('[AIService] Error calling AI Engine for video generation:', err.message);

            if (err.response) {
                // The request was made and the server responded with a status code
                // that falls out of the range of 2xx
                throw new Error(`Video generation failed: ${err.response.status} - ${JSON.stringify(err.response.data)}`);
            } else if (err.request) {
                // The request was made but no response was received
                throw new Error('AI Engine unreachable for video generation. Please verify the service is running.');
            }

            // Fallback for other errors
            throw new Error(`Video generation failed: ${err.message}`);
        }
    }
}

// Export singleton instance
export const aiService = new AIServiceConsumer();
