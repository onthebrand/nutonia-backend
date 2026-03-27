
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function listModels() {
    try {
        const result = await genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }).listModels();
        console.log(JSON.stringify(result, null, 2));
    } catch (err) {
        console.error('Error listing models:', err.message);
    }
}

listModels();
