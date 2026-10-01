import Groq from 'groq-sdk';
import config from '../config.js';

class LLMService {
    constructor() {
        this.groq = null;
        this.abortController = null;
    }

    _ensureClient() {
        if (!this.groq) {
            if (!config.GROQ_API_KEY) {
                throw new Error("LLM: GROQ_API_KEY is missing from environment.");
            }
            this.groq = new Groq({ apiKey: config.GROQ_API_KEY });
        }
    }

    async streamResponse(prompt, onChunk, onDone) {
        // Interruption: Abort previous stream
        if (this.abortController) {
            this.abortController.abort();
            console.log('[LLM] Aborted previous stream');
        }

        this.abortController = new AbortController();
        const { signal } = this.abortController;

        try {
            this._ensureClient();
            const stream = await this.groq.chat.completions.create({
                messages: [
                    { role: 'system', content: 'You are a highly professional tech interviewer. Keep responses very brief (1-3 sentences). Wait for candidate to answer.' },
                    { role: 'user', content: prompt }
                ],
                model: config.GROQ_LLM_MODEL || 'openai/gpt-oss-120b',
                stream: true,
            }, { signal });

            let phraseBuffer = '';
            let wordCount = 0;

            for await (const chunk of stream) {
                const token = chunk.choices[0]?.delta?.content || '';
                phraseBuffer += token;

                const words = token.trim().split(/\s+/).filter(Boolean);
                wordCount += words.length;

                const hasTerminalPunctuation = /[.!?]/.test(token);
                if (wordCount >= 10 || hasTerminalPunctuation) {
                    onChunk(phraseBuffer);
                    phraseBuffer = '';
                    wordCount = 0;
                }
            }

            if (phraseBuffer) onChunk(phraseBuffer);
            onDone();
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('[LLM] Stream aborted');
            } else {
                console.error('[LLM-ERROR]', err);
            }
        } finally {
            this.abortController = null;
        }
    }

    interrupt() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }
}

export default LLMService;
