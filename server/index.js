'use strict';
// Compatibility entry point: the application is written in TypeScript (server/typed) and built to server/generated.
const { createServerApp, startServer } = require('./generated/app');

const app = createServerApp();
if (require.main === module) startServer(app);
module.exports = app;
