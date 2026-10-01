import WebSocket, { WebSocketServer } from 'ws';
import { Buffer } from 'node:buffer';
import { getSTTServiceProvider } from './services/stt/factory.js';
import { getTTSServiceProvider } from './services/tts/factory.js';
import LLMService from './services/llm.js';
import config, { validateConfig } from './config.js';

// Pre-validate environment
validateConfig();

const port = config.PORT;
const wss = new WebSocketServer({ port });

const sttProvider = getSTTServiceProvider();
const ttsProvider = getTTSServiceProvider();
const llm = new LLMService();

console.log(`--- [VOICE-PIPELINE] Server starting on port ${port} ---`);

wss.on('connection', (ws) => {
    console.log('[WS] New Client Connected');
    let sttStreaming = null;

    const stopAll = () => {
        llm.interrupt();
        ttsProvider.interrupt();
        ws.send(JSON.stringify({ type: 'interrupt', data: {} })); // Clear client queue
    };

    ws.on('message', async (message) => {
        // Binary: Raw Audio from client
        if (Buffer.isBuffer(message)) {
            if (!sttStreaming) {
                sttStreaming = sttProvider.startStreaming(
                    (transcript) => {
                        ws.send(JSON.stringify({ type: 'transcript', data: transcript }));
                        if (transcript.is_final) {
                            console.log('[STT] Final:', transcript.text);
                            llm.streamResponse(
                                transcript.text, 
                                (phrase) => ttsProvider.streamSpeech(phrase, (audio) => ws.send(audio)),
                                () => ws.send(JSON.stringify({ type: 'status', data: 'idle' }))
                            );
                        }
                    },
                    (e) => console.error('[STT-ERROR]', e)
                );
            }
            // Send the binary chunk to the active STT provider
            sttStreaming.send(message);
        } else {
            // JSON Commands
            try {
                const cmd = JSON.parse(message);
                if (cmd.type === 'interrupt') {
                    console.log('[WS] Interruption Signal Received');
                    stopAll();
                }
            } catch (e) {}
        }
    });

    ws.on('error', (e) => console.error('[WS-ERROR]', e));
    ws.on('close', () => {
        if (sttStreaming) sttStreaming.finish();
        llm.interrupt();
        ttsProvider.interrupt();
        console.log('[WS] Disconnected');
    });
});
