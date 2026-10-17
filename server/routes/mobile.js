'use strict';
const express = require('express');
const { openSse } = require('../lib/sse');

const router = express.Router();

router.get('/sites/:id/mobile/run', async (req, res) => {
  const stream = openSse(res);
  try {
    if (process.env.WEB_SECURITY_HUB_PACKAGED === '1') throw new Error('This desktop distribution includes web automation only. Use the source/CLI distribution for mobile automation.');
    const { runMobileSession } = require('../services/mobileService');
    stream.send('done', await runMobileSession(req.params.id, (line) => stream.send('log', { line })));
  } catch (error) {
    stream.send('error', { message: error.message });
  } finally {
    stream.close();
  }
});

module.exports = router;
