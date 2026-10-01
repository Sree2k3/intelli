import { createClient } from '@deepgram/sdk';
import config from '../../config.js';

class DeepgramSTTProvider {
    constructor() {
        this.deepgram = null;
    }

    _ensureClient() {
        if (!this.deepgram) {
            if (!config.DEEPGRAM_API_KEY) {
                throw new Error("Deepgram STT: DEEPGRAM_API_KEY is missing from environment. Cannot start transcription.");
            }
            this.deepgram = createClient(config.DEEPGRAM_API_KEY);
        }
    }

    startStreaming(onTranscript, onError) {
        try {
            this._ensureClient();
        } catch (err) {
            onError(err);
            // Return dummy send/finish to avoid crashing the caller
            return { send: () => {}, finish: () => {}, getReadyState: () => 0 };
        }

        const dgLive = this.deepgram.listen.live({
            model: config.DEEPGRAM_STT_MODEL || 'nova-2',
            smart_format: true,
            interim_results: true,
            language: 'en-US',
            encoding: 'linear16',
            sample_rate: 16000,
            endpointing: 500,
        });

        dgLive.on('open', () => console.log('[STT-DEEPGRAM] Connected'));
        dgLive.on('transcript', (data) => {
            const transcript = data.channel.alternatives[0].transcript;
            if (!transcript) return;
            onTranscript({
                text: transcript,
                is_final: data.is_final || data.speech_final
            });
        });
        dgLive.on('error', (err) => {
            console.error('[STT-DEEPGRAM-ERROR]', err);
            onError(err);
        });
        
        return {
            send: (chunk) => {
                if (dgLive.getReadyState() === 1) {
                    dgLive.send(chunk);
                }
            },
            getReadyState: () => dgLive.getReadyState(),
            finish: () => dgLive.finish()
        };
    }

    async transcribeFile(audioBuffer) {
        this._ensureClient();
        const { result, error } = await this.deepgram.listen.prerecorded.transcribeBuffer(
            audioBuffer,
            { model: config.DEEPGRAM_STT_MODEL, smart_format: true }
        );
        if (error) throw error;
        return result.results.channels[0].alternatives[0].transcript;
    }
}

export default DeepgramSTTProvider;
