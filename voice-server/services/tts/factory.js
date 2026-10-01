import DeepgramTTSProvider from './deepgram.js';
import ElevenLabsTTSProvider from './elevenlabs.js';
import config from '../../config.js';

let ttsInstance = null;

/**
 * TTS Factory - returns singleton provider instance
 */
export function getTTSServiceProvider() {
  if (ttsInstance) {
    return ttsInstance;
  }

  const provider = (config.TTS_PROVIDER || "").toLowerCase();

  if (!provider) {
    console.warn("[TTS-FACTORY] No provider set. Defaulting to Deepgram.");
    ttsInstance = new DeepgramTTSProvider();
    return ttsInstance;
  }

  console.log(`[TTS-FACTORY] Initializing provider: ${provider}`);

  switch (provider) {
    case 'deepgram':
      ttsInstance = new DeepgramTTSProvider();
      break;
    case 'elevenlabs':
      ttsInstance = new ElevenLabsTTSProvider();
      break;
    default:
      console.warn(`[TTS-FACTORY] Unknown provider "${provider}". Falling back to Deepgram.`);
      ttsInstance = new DeepgramTTSProvider();
  }

  return ttsInstance;
}
