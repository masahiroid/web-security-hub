// Inert source-analysis fixture. Shared code has two declared route candidates.
const express = require('express');
const app = express();
function shared(request, response) {
  response.json({ result: eval(request.body.value) });
}
app.post('/first', shared);
app.post('/second', shared);
module.exports = app;
