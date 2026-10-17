// Remediated teaching example. Parameter binding must be provided by the DB driver.
function safeCalculation(userInput) {
  const value = Number(userInput);
  if (!Number.isFinite(value)) throw new Error('Expected a number');
  return value;
}
function safeQuery(name) {
  return { text: 'SELECT * FROM workshops WHERE name = ?', values: [name] };
}
