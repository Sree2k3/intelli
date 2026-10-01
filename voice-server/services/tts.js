const { createClient } = require('@deepgram/sdk');

class TTSService {
    constructor(apiKey) {
        this.deepgram = createClient(apiKey);
        this.isInterrupted = false;
    }

    async streamSpeech(text, onAudioChunk) {
        if (!text.trim()) return;
        this.isInterrupted = false;

        try {
            const response = await this.deepgram.speak.request(
                { text },
                {
                    model: 'aura-asteria-en',
                    encoding: 'linear16',
                    container: 'none',
                    sample_rate: 16000,
                }
            );

            const stream = await response.getStream();
            const reader = stream.getReader();

            while (true) {
                if (this.isInterrupted) {
                    console.log('[TTS] Aborting current speech stream');
                    break;
                }
                const { done, value } = await reader.read();
                if (done) break;
                onAudioChunk(value);
            }
        } catch (err) {
            console.error('[TTS] Error generative speech:', err);
        }
    }

    interrupt() {
        this.isInterrupted = true;
    }
}

module.exports = TTSService;
