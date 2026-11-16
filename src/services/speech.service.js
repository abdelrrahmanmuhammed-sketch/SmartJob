const config = require('../config');

/**
 * Speech-to-Text (STT) Service
 * Accepts audio buffer and metadata, converts spoken Arabic into text.
 */
async function transcribeAudio({ buffer, originalname = 'audio.webm', mimetype = 'audio/webm' }) {
  if (!buffer || !buffer.length) {
    throw new Error('لم يتم استلام أي ملف صوتي للمعالجة');
  }

  // 1. OpenAI Whisper API
  if (config.openaiApiKey) {
    try {
      const formData = new FormData();
      const blob = new Blob([buffer], { type: mimetype || 'audio/webm' });
      formData.append('file', blob, originalname || 'recording.webm');
      formData.append('model', 'whisper-1');
      formData.append('language', 'ar');
      formData.append('prompt', 'تسجيل صوتي لباحث عن عمل أو صاحب عمل بالعامية المصرية أو العربية الفصحى: نقاش، سباك، كهربائي، حداد، نجار، في القاهرة، الإسكندرية، كفر الشيخ');

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.openaiApiKey}`
        },
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        if (data.text && data.text.trim()) {
          return {
            text: data.text.trim(),
            provider: 'openai-whisper',
            language: 'ar'
          };
        }
      } else {
        const errText = await res.text();
        console.warn(`[WHISPER_ERROR] Status: ${res.status} Body: ${errText}`);
      }
    } catch (err) {
      console.warn('[WHISPER_CALL_FAILED]', err.message);
    }
  }

  // 2. Fallback / Test transcription handler
  // If Whisper is unavailable (e.g. offline dev or no key), return a graceful fallback prompt
  return {
    text: '',
    provider: 'browser-fallback',
    message: 'يمكن استخدام الإدخال الصوتي المباشر للمتصفح أو كتابة الطلب نصياً'
  };
}

/**
 * Text-to-Speech (TTS) Service
 * Converts Arabic text into spoken audio buffer.
 */
async function synthesizeSpeech(text, { voice = 'onyx', model = 'tts-1' } = {}) {
  if (!text || !text.trim()) {
    throw new Error('النص المراد تحويله إلى صوت فارغ');
  }

  const cleanText = text.trim();

  // 1. OpenAI TTS API
  if (config.openaiApiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.openaiApiKey}`
        },
        body: JSON.stringify({
          model: model || 'tts-1',
          input: cleanText,
          voice: voice || 'onyx', // onyx and nova are clear for Arabic pronunciation
          response_format: 'mp3'
        })
      });

      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        return {
          buffer: Buffer.from(arrayBuffer),
          contentType: 'audio/mpeg',
          provider: 'openai-tts'
        };
      } else {
        console.warn(`[OPENAI_TTS_ERROR] Status: ${res.status}`);
      }
    } catch (err) {
      console.warn('[OPENAI_TTS_FAILED]', err.message);
    }
  }

  // Fallback: indicate that client should use Web Speech API synthesis
  return {
    buffer: null,
    contentType: null,
    provider: 'browser-speech-synthesis',
    text: cleanText
  };
}

module.exports = {
  transcribeAudio,
  synthesizeSpeech
};
