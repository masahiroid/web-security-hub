// Inert source-analysis fixture. Never import, execute, or serve this file.
const express = require('express');
const app = express();
const router = express.Router();
function calculate(value) {
  return eval(value);
}
router.post('/calculate', (request, response) => response.json({ result: calculate(request.body.value) }));
app.use('/api', router);
module.exports = app;
