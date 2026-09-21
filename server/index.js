'use strict';
const express = require('express');
const path = require('path');

const sitesRoutes = require('./routes/sites');
const systemInfoRoutes = require('./routes/systemInfo');
const controlRoutes = require('./routes/control');
const securityRoutes = require('./routes/security');
const testGenerationRoutes = require('./routes/testGeneration');
const pipelineRoutes = require('./routes/pipeline');
const replayRoutes = require('./routes/replay');
const testCasesRoutes = require('./routes/testCases');
const reportRoutes = require('./routes/report');
const aiReviewRoutes = require('./routes/aiReview');
const staticReportsRoutes = require('./routes/staticReports');
const scenarioRecorderRoutes = require('./routes/scenarioRecorder');
const authSessionRoutes = require('./routes/authSession');
const exploreRoutes = require('./routes/explore');
const mobileRoutes = require('./routes/mobile');

const app = express();
app.use(express.json({ limit: '5mb' }));

app.use('/api', sitesRoutes);
app.use('/api', securityRoutes);
app.use('/api', testGenerationRoutes);
app.use('/api', pipelineRoutes);
app.use('/api', replayRoutes);
app.use('/api', testCasesRoutes);
app.use('/api', reportRoutes);
app.use('/api', aiReviewRoutes);
app.use('/api', staticReportsRoutes);
app.use('/api', scenarioRecorderRoutes);
app.use('/api', authSessionRoutes);
app.use('/api', exploreRoutes);
app.use('/api', mobileRoutes);
app.use('/api', systemInfoRoutes);
app.use('/api', controlRoutes);

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

const PORT = process.env.PORT || 4173;
if (require.main === module) {
  const httpServer = app.listen(PORT, () => {
    console.log(`Web Security Hub listening on http://localhost:${PORT}`);
  });
  // Exposed so server/routes/control.js can close/restart this exact
  // listener from a request handler (stop/restart buttons in the UI).
  app.set('httpServer', httpServer);
}

module.exports = app;
