// Inert SAST fixture. Never imported or executed by the sample server.
function unsafeCalculation(userInput) {
  return eval(userInput);
}
function unsafeQuery(name) {
  return "SELECT * FROM workshops WHERE name = '" + name + "'";
}
