const assert = require("node:assert/strict");
const test = require("node:test");

test("fixture runner executes a real unit test", () => {
  assert.equal(1 + 1, 2);
});
