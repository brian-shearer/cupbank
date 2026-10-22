import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createDashboardApp } from "../dashboard.js";

test("dashboard renders DynamoDB inventory and customer balances", async (t) => {
  const calls = [];
  const database = {
    async send(command) {
      assert.ok(command instanceof ScanCommand);
      calls.push(command.input);

      if (command.input.TableName === "Inventory") {
        if (!command.input.ExclusiveStartKey) {
          return {
            Items: [
              {
                inventoryid: "inventory-2",
                description: "<Main>",
                cups: 8,
              },
            ],
            LastEvaluatedKey: { inventoryid: "inventory-2" },
          };
        }
        return {
          Items: [
            { inventoryid: "inventory-1", description: "Cafe", cups: 4 },
          ],
        };
      }

      return {
        Items: [{ customerid: "customer-1", cups: 3 }],
      };
    },
  };
  const server = createDashboardApp(database).listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, "listening");

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/`,
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.match(html, /inventory-1/);
  assert.match(html, /inventory-2/);
  assert.match(html, /customer-1/);
  assert.match(html, />12<\/strong>/);
  assert.match(html, />3<\/strong>/);
  assert.match(html, /&lt;Main&gt;/);
  assert.doesNotMatch(html, /<Main>/);
  assert.deepEqual(calls, [
    { TableName: "Inventory" },
    { TableName: "CustomerCup" },
    {
      TableName: "Inventory",
      ExclusiveStartKey: { inventoryid: "inventory-2" },
    },
  ]);
});
