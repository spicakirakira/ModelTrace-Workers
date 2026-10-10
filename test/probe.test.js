import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import http from "node:http";

test("Worker: POST /api/test/probe calls upstream API and evaluates parsed numbers", async () => {
  // Setup a mock OpenAI API server
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const parsedBody = JSON.parse(body);
      const numbers = Array.from({ length: 200 }, (_, i) => (i % 355) + 1).join(" ");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: numbers,
              },
              finish_reason: "stop",
            },
          ],
        })
      );
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const probePayload = {
      base_url: `http://127.0.0.1:${port}/v1`,
      api_key: "dummy-key",
      api_model: "test-model",
      prompt: "Give me numbers",
      expected_count: 200,
    };

    const res = await worker.fetch(
      new Request("https://example.com/api/test/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(probePayload),
      })
    );

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.parsed_numbers, 200);
    assert.equal(data.minimum_numbers, 111);
    assert.equal(data.accepted, true);
    assert.ok(data.text);
  } finally {
    server.close();
  }
});
