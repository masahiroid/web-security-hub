'use strict';

// Per-client limits for local file-backed report and welcome endpoints.
// A separate store is created for each route to keep ordinary UI polling independent.
const FILE_SERVING_LIMITS = Object.freeze({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false });
module.exports = { FILE_SERVING_LIMITS };
