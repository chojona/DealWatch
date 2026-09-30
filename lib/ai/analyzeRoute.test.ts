import assert from "node:assert/strict";
import { test } from "node:test";
import { PUT } from "@/app/api/analyze/route";

test("saving a thread analysis does not create deal history", async () => {
  const response = await PUT();

  assert.equal(response.status, 410);
  const body = await response.json();
  assert.equal(body.error, "Thread analysis is not saved as deal history");
});
