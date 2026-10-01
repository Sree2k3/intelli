import { createClient } from '@deepgram/sdk';
import config from '../../config.js';

class DeepgramTTSProvider {
  constructor() {
    this.deepgram = null;
    this.isInterrupted = false;
  }

  _ensureClient() {
    if (!this.deepgram) {
        if (!config.DEEPGRAM_API_KEY) {
            throw new Error("Deepgram TTS: DEEPGRAM_API_KEY is missing from environment.");
        }
        this.deepgram = createClient(config.DEEPGRAM_API_KEY);
    }
  }

  async streamSpeech(text, onAudioChunk) {
    if (!text.trim()) return;
    this.isInterrupted = false;
    
    try {
      this._ensureClient();
      const response = await this.deepgram.speak.request(
        { text },
        {
          model: config.DEEPGRAM_TTS_MODEL || 'aura-asteria-en',
          encoding: 'linear16',
          container: 'none',
          sample_rate: config.DEEPGRAM_TTS_SAMPLE_RATE || 16000,
        }
      );

      const stream = await response.getStream();
      const reader = stream.getReader();

      while (true) {
        if (this.isInterrupted) {
          console.log('[TTS-DEEPGRAM] Aborting current speech stream');
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        onAudioChunk(value);
      }
    } catch (err) {
      console.error('[TTS-DEEPGRAM-ERROR]', err);
    }
  }

  interrupt() {
    this.isInterrupted = true;
  }
}

export default DeepgramTTSProvider;
