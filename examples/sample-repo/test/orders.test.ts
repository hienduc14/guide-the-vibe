import { test } from "node:test";
import assert from "node:assert/strict";
import { placeOrder } from "../src/orders/service.ts";

test("gold users get 10% off", () => {
  assert.equal(placeOrder(1, 1000).total, 900);
});
