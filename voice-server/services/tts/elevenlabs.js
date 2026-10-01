import config from '../../config.js';

class ElevenLabsTTSProvider {
  constructor() {
    this.apiKey = config.ELEVENLABS_API_KEY;
    this.isInterrupted = false;
  }

  async streamSpeech(text, onAudioChunk) {
    if (!text.trim() || !this.apiKey) return;
    this.isInterrupted = false;
    
    // Example: fetch directly from ElevenLabs v1/text-to-speech/{voice_id}/stream
    // The implementation would pipe the stream into onAudioChunk.
    console.log('[TTS-ELEVENLABS] Using voice id:', config.ELEVENLABS_VOICE_ID);
    
    // Placeholder logic:
    // const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}/stream`, ...);
    // const body = response.body; 
    // for await (const chunk of body) { if(this.isInterrupted) break; onAudioChunk(chunk); }
  }

  interrupt() {
    this.isInterrupted = true;
  }
}

export default ElevenLabsTTSProvider;
