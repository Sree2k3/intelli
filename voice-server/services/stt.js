const { createClient } = require('@deepgram/sdk');

class STTService {
    constructor(apiKey) {
        this.deepgram = createClient(apiKey);
    }

    startStreaming(onTranscript, onError) {
        const dgLive = this.deepgram.listen.live({
            model: 'nova-2',
            smart_format: true,
            interim_results: true,
            language: 'en-US',
            encoding: 'linear16',
            sample_rate: 16000,
            endpointing: 500, // Detect end of speech after 500ms silence
        });

        dgLive.on('open', () => console.log('[STT] Connected'));
        dgLive.on('transcript', (data) => {
            const transcript = data.channel.alternatives[0].transcript;
            if (!transcript) return;
            onTranscript({
                text: transcript,
                is_final: data.is_final || data.speech_final
            });
        });
        dgLive.on('error', onError);

        return dgLive;
    }
}

module.exports = STTService;
