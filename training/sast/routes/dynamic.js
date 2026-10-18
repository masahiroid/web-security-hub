// Inert source-analysis fixture. The path cannot be established statically.
const express = require('express');
const app = express();
const routeName = process.env.TRAINING_ROUTE;
app.post(routeName, (request, response) => response.json({ result: eval(request.body.value) }));
module.exports = app;
