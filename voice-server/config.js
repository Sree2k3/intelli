import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Attempt to load from current folder OR parent folder OR backend folder
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

/**
 * config.js — Centralized environment configuration for the Voice Pipeline.
 */
const config = {
  // ── Server ──────────────────────────────────────────────────────────────────
  PORT: process.env.PORT || 8081,

  // ── Provider Selection ──────────────────────────────────────────────────────
  STT_PROVIDER: (process.env.STT_PROVIDER || 'deepgram').toLowerCase(),
  TTS_PROVIDER: (process.env.TTS_PROVIDER || 'deepgram').toLowerCase(),

  // ── Deepgram ────────────────────────────────────────────────────────────────
  DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY || '',
  DEEPGRAM_STT_MODEL: process.env.DEEPGRAM_STT_MODEL || 'nova-2',
  DEEPGRAM_TTS_MODEL: process.env.DEEPGRAM_TTS_MODEL || 'aura-asteria-en',
  DEEPGRAM_TTS_SAMPLE_RATE: parseInt(process.env.DEEPGRAM_TTS_SAMPLE_RATE || '16000', 10),

  // ── Groq (Whisper STT) ─────────────────────────────────────────────────────
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  GROQ_LLM_MODEL: process.env.GROQ_LLM_MODEL || 'openai/gpt-oss-120b',
  GROQ_WHISPER_MODEL: process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',

  // ── ElevenLabs (TTS) ───────────────────────────────────────────────────────
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || '',
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',
  ELEVENLABS_MODEL_ID: process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5',

  // ── AssemblyAI (STT) ───────────────────────────────────────────────────────
  ASSEMBLYAI_API_KEY: process.env.ASSEMBLYAI_API_KEY || '',
};

export function validateConfig() {
  const warnings = [];

  const sttKeyMap = {
    deepgram:   () => !config.DEEPGRAM_API_KEY && 'DEEPGRAM_API_KEY is required for Deepgram STT',
    whisper:    () => !config.GROQ_API_KEY     && 'GROQ_API_KEY is required for Whisper STT',
  };

  const ttsKeyMap = {
    deepgram:   () => !config.DEEPGRAM_API_KEY && 'DEEPGRAM_API_KEY is required for Deepgram TTS',
    elevenlabs: () => !config.ELEVENLABS_API_KEY && 'ELEVENLABS_API_KEY is required for ElevenLabs TTS',
  };

  const sttCheck = sttKeyMap[config.STT_PROVIDER];
  if (sttCheck) {
    const msg = sttCheck();
    if (msg) warnings.push(msg);
  }

  const ttsCheck = ttsKeyMap[config.TTS_PROVIDER];
  if (ttsCheck) {
    const msg = ttsCheck();
    if (msg) warnings.push(msg);
  }

  if (!config.GROQ_API_KEY) {
    warnings.push('GROQ_API_KEY is missing — LLM responses will fail');
  }

  if (warnings.length === 0) {
    console.log('[CONFIG] All required keys found! ✅');
  } else {
    warnings.forEach(w => console.warn(`[CONFIG] ⚠ ${w}`));
  }

  console.log(`[CONFIG] STT Provider : ${config.STT_PROVIDER}`);
  console.log(`[CONFIG] TTS Provider : ${config.TTS_PROVIDER}`);

  return warnings.length === 0;
}

export default config;
