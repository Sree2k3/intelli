import DeepgramSTTProvider from './deepgram.js';
import WhisperSTTProvider from './whisper.js';
import config from '../../config.js';

let sttInstance = null;

/**
* STT Factory - returns singleton provider instance
*/
export function getSTTServiceProvider() {
  // Return existing instance (singleton)
  if (sttInstance) {
    return sttInstance;
  }

  // Normalize provider name
  const provider = (config.STT_PROVIDER || "").toLowerCase();

  // Handle missing provider
  if (!provider) {
    console.warn("[STT-FACTORY] No provider set. Defaulting to Deepgram.");
    sttInstance = new DeepgramSTTProvider();
    return sttInstance;
  }

  console.log(`[STT-FACTORY] Initializing provider: ${provider}`);

  // Select provider
  switch (provider) {
    case 'deepgram':
      sttInstance = new DeepgramSTTProvider();
      break;

    case 'whisper':
      sttInstance = new WhisperSTTProvider();
      break;

    default:
      console.warn(
        `[STT-FACTORY] Unknown provider "${provider}". Falling back to Deepgram.`
      );
      sttInstance = new DeepgramSTTProvider();
  }

  return sttInstance;
}

console.log(`[STT] Provider: ${config.STT_PROVIDER}`);