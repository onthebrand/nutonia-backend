
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.VITE_GOOGLE_API_KEY;

if (!apiKey) {
    console.error("API Key not found");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function listModels() {
    try {
        // @ts-ignore
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        // There isn't a direct listModels on the instance, but let's try to infer or check specific ones.
        // Actually, listing models requires the API client directly or checking docs.
        // Since I can't list models via this SDK easily without the newer version's method (if available),
        // I will try to generate an image with 'imagen-2' and 'imagen-3' to see which one works.
        // But the previous error gave a clear 404.

        console.log("Checking known models...");
        // List of candidates
        const candidates = ['imagen-3.0-generate-001', 'imagen-2.0-generate-001', 'imagen-2'];

        // We can't easily check validity without generating.
        console.log("Cannot list models directly with this SDK version easily. Proceeding to try 'imagen-2.0-generate-001'.");

    } catch (error) {
        console.error("Error:", error);
    }
}

listModels();
