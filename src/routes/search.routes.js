const express = require('express');
const { extractVoiceIntent, executeStructuredSearch } = require('../services/voiceSearch.service');
const { CRAFTS, GOVERNORATES } = require('../utils/arabic.utils');
const { optionalAuthenticate } = require('../middleware/auth.middleware');

const router = express.Router();

// POST /api/search/voice
router.post('/voice', optionalAuthenticate, async (req, res, next) => {
  try {
    const { transcript, defaultTarget = 'jobs' } = req.body;

    if (!transcript || !transcript.trim()) {
      return res.status(400).json({
        success: false,
        message: 'يرجى تقديم النص المنطوق أو المكتوب للبحث'
      });
    }

    // Determine default target based on role if logged in
    let roleTarget = defaultTarget;
    if (req.user && req.user.role === 'COMPANY') {
      roleTarget = 'workers';
    } else if (req.user && req.user.role === 'WORKER') {
      roleTarget = 'jobs';
    }

    // 1. Structured Intent Extraction
    const intent = extractVoiceIntent(transcript.trim(), roleTarget);

    // 2. Query Real Database Records
    const searchResults = await executeStructuredSearch(intent);

    res.json({
      success: true,
      ...searchResults
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/search/meta
router.get('/meta', (req, res) => {
  res.json({
    success: true,
    crafts: CRAFTS.map(c => ({ key: c.key, canonical: c.canonical, label: c.label })),
    locations: GOVERNORATES
  });
});

module.exports = router;
