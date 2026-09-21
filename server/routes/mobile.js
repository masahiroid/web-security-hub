'use strict';
const express = require('express');
const { openSse } = require('../lib/sse');
const { runMobileSession } = require('../services/mobileService');

const router = express.Router();

router.get('/sites/:id/mobile/run', async (req, res) => {
  const stream = openSse(res);
  try {
    stream.send('done', await runMobileSession(req.params.id, (line) => stream.send('log', { line })));
  } catch (error) {
    stream.send('error', { message: error.message });
  } finally {
    stream.close();
  }
});

module.exports = router;
