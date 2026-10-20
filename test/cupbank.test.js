import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import app from "../app.js";
import cupController from "../controllers/cupController.js";
import database from "../services/database.js";

test("Cupbank HTTP routes", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/cupbank`;
  let records;
  let commands;
  let transactionFailure;

  const key = (table, id) => `${table}:${id}`;
  const send = t.mock.method(database, "send", async (command) => {
    commands.push(command);
    const input = command.input;
    if (command instanceof GetCommand) {
      assert.equal(typeof input.Key.id, "string");
      assert.equal(input.ConsistentRead, true);
      return { Item: records.get(key(input.TableName, input.Key.id)) };
    }
    if (command instanceof PutCommand) {
      assert.equal(input.ConditionExpression, "attribute_not_exists(id)");
      records.set(key(input.TableName, input.Item.id), { ...input.Item });
      return {};
    }
    if (command instanceof ScanCommand) {
      return {
        Items: [...records.values()].filter((record) => record.id === "location-1"),
      };
    }
    if (command instanceof DeleteCommand) {
      assert.equal(input.ConditionExpression, "attribute_exists(id)");
      if (!records.delete(key(input.TableName, input.Key.id))) {
        throw Object.assign(new Error("Missing record"), {
          name: "ConditionalCheckFailedException",
        });
      }
      return {};
    }
    assert.ok(command instanceof TransactWriteCommand);
    assert.equal(input.TransactItems.length, 2);
    assert.deepEqual(
      input.TransactItems.map(({ Update }) => Update.TableName),
      ["CustomerCup", "Inventory"],
    );
    if (transactionFailure) {
      throw transactionFailure;
    }
    for (const { Update } of input.TransactItems) {
      assert.equal(Update.UpdateExpression, "SET #cups = :updated");
      assert.equal(
        Update.ConditionExpression,
        "attribute_exists(id) AND #cups = :previous",
      );
      assert.deepEqual(Update.ExpressionAttributeNames, { "#cups": "cups" });
      const record = records.get(key(Update.TableName, Update.Key.id));
      assert.equal(record.cups, Update.ExpressionAttributeValues[":previous"]);
      assert.ok(Update.ExpressionAttributeValues[":updated"] >= 0);
    }
    for (const { Update } of input.TransactItems) {
      const record = records.get(key(Update.TableName, Update.Key.id));
      records.set(key(Update.TableName, Update.Key.id), {
        ...record,
        cups: Update.ExpressionAttributeValues[":updated"],
      });
    }
    return {};
  });

  t.beforeEach(() => {
    records = new Map([
      [key("CustomerCup", "customer-1"), { id: "customer-1", cups: 5 }],
      [
        key("Inventory", "location-1"),
        { id: "location-1", description: "Cafe", cups: 10 },
      ],
    ]);
    commands = [];
    transactionFailure = undefined;
  });

  async function request(path, method = "GET", body) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: response.status === 204 ? undefined : await response.json(),
    };
  }

  const transfer = { customerid: "customer-1", locationid: "location-1", cups: 2 };

  try {
    await t.test("creates a zero-balance customer from an empty body", async () => {
      const result = await request("/customer", "POST", {});
      assert.equal(result.status, 201);
      assert.match(result.body.data.id, /^[0-9a-f-]{36}$/);
      assert.equal(result.body.data.cups, 0);
      assert.deepEqual(commands[0].input.Item, result.body.data);
      assert.equal(commands[0].input.TableName, "CustomerCup");
    });

    await t.test("creates a customer without a request body", async () => {
      assert.equal((await request("/customer", "POST")).status, 201);
    });

    await t.test("rejects customer creation fields instead of ignoring them", async () => {
      assert.equal((await request("/customer", "POST", transfer)).status, 400);
      assert.equal(commands.length, 0);
    });

    await t.test("creates inventory with converted numeric cups", async () => {
      const result = await request("/inventory", "POST", {
        description: "Cafe",
        cups: "0",
      });
      assert.equal(result.status, 201);
      assert.equal(result.body.data.cups, 0);
      assert.equal(commands[0].input.TableName, "Inventory");
    });

    await t.test("lists inventory and reads individual balances", async () => {
      const list = await request("/inventory");
      assert.equal(list.status, 200);
      assert.equal(list.body.length, 1);
      for (const [path, id, cups] of [
        ["/inventory/location-1", "location-1", 10],
        ["/customer/customer-1", "customer-1", 5],
      ]) {
        assert.deepEqual(await request(path), {
          status: 200,
          body: { id, cups },
        });
      }
    });

    await t.test("returns a single inventory scan without fetching more pages", async (st) => {
      const scan = st.mock.method(database, "send", async (command) => {
        assert.ok(command instanceof ScanCommand);
        return { Items: [{ id: "first" }], LastEvaluatedKey: { id: "first" } };
      });
      const res = {
        status(code) {
          assert.equal(code, 200);
          return this;
        },
        json(body) {
          assert.deepEqual(body, [{ id: "first" }]);
        },
      };
      await cupController.getInventory({}, res, (error) => {
        throw error;
      });
      assert.equal(scan.mock.callCount(), 1);
      assert.deepEqual(scan.mock.calls[0].arguments[0].input, {
        TableName: "Inventory",
      });
    });

    for (const operation of ["withdraw", "deposit"]) {
      await t.test(`${operation} atomically updates both balances`, async () => {
        const result = await request(`/customer/${operation}`, "PUT", {
          ...transfer,
          cups: "2",
        });
        assert.equal(result.status, 200);
        assert.equal(
          result.body.message,
          operation === "withdraw" ? "Withdrawal completed" : "Deposit completed",
        );
        assert.equal(result.body.customer.cups, operation === "withdraw" ? 7 : 3);
        assert.equal(result.body.inventory.cups, operation === "withdraw" ? 8 : 12);
        assert.equal(result.body.inventory.description, "Cafe");
        assert.equal(result.body.customer.cups + result.body.inventory.cups, 15);
        assert.equal(commands.length, 3);
        assert.ok(commands[2] instanceof TransactWriteCommand);
        assert.deepEqual(
          records.get(key("CustomerCup", "customer-1")),
          result.body.customer,
        );
        assert.deepEqual(
          records.get(key("Inventory", "location-1")),
          result.body.inventory,
        );
      });

      await t.test(`${operation} rejects insufficient cups without writing`, async () => {
        const result = await request(`/customer/${operation}`, "PUT", {
          ...transfer,
          cups: 11,
        });
        assert.equal(result.status, 409);
        assert.match(result.body.error, /Insufficient/);
        assert.equal(commands.length, 2);
      });

      for (const cups of [0, -1, 0.5, "bad", Number.MAX_SAFE_INTEGER + 1]) {
        await t.test(`${operation} rejects invalid cups: ${cups}`, async () => {
          const result = await request(`/customer/${operation}`, "PUT", {
            ...transfer,
            cups,
          });
          assert.equal(result.status, 400);
          assert.equal(commands.length, 0);
        });
      }

      await t.test(`${operation} rejects a missing body`, async () => {
        assert.equal((await request(`/customer/${operation}`, "PUT")).status, 400);
        assert.equal(commands.length, 0);
      });

      for (const table of ["CustomerCup", "Inventory"]) {
        await t.test(`${operation} reports a missing ${table}`, async () => {
          records.delete(
            key(table, table === "CustomerCup" ? "customer-1" : "location-1"),
          );
          assert.equal(
            (await request(`/customer/${operation}`, "PUT", transfer)).status,
            404,
          );
          assert.ok(commands.every((command) => command instanceof GetCommand));
        });
      }

      await t.test(`${operation} reports a concurrent change without partial writes`, async () => {
        transactionFailure = Object.assign(new Error("Conditional failure"), {
          name: "TransactionCanceledException",
          CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
        });
        const before = [...records.entries()];
        const result = await request(`/customer/${operation}`, "PUT", transfer);
        assert.equal(result.status, 409);
        assert.match(result.body.error, /retry/);
        assert.deepEqual([...records.entries()], before);
      });
    }

    await t.test("rejects receiver balance overflow", async () => {
      records.get(key("CustomerCup", "customer-1")).cups = Number.MAX_SAFE_INTEGER;
      const result = await request("/customer/withdraw", "PUT", transfer);
      assert.equal(result.status, 409);
      assert.equal(commands.length, 2);
    });

    await t.test("missing balance records return 404, not zero", async () => {
      for (const path of ["/customer/missing", "/inventory/missing"]) {
        assert.equal((await request(path)).status, 404);
      }
    });

    await t.test("deletes a customer by ID and reports subsequent absence", async () => {
      assert.equal((await request("/customer/customer-1", "DELETE")).status, 204);
      assert.equal((await request("/customer/customer-1", "DELETE")).status, 404);
      assert.ok(commands[0] instanceof DeleteCommand);
      assert.deepEqual(commands[0].input.Key, { id: "customer-1" });
    });

    await t.test("removed collection GET/DELETE routes do not access DynamoDB", async () => {
      for (const method of ["GET", "DELETE"]) {
        const response = await fetch(`${base}/customer`, { method });
        assert.equal(response.status, 404);
        await response.text();
      }
      assert.equal(commands.length, 0);
    });

    await t.test("database failures are logged and return JSON errors", async (st) => {
      const failure = new Error("Database unavailable");
      st.mock.method(database, "send", async () => {
        throw failure;
      });
      const log = st.mock.method(console, "error", () => {});
      assert.deepEqual(await request("/inventory/location-1"), {
        status: 500,
        body: { error: "Internal server error" },
      });
      assert.equal(log.mock.calls[0].arguments[0], failure);
    });

    await t.test("failed transactions surface errors and leave both records unchanged", async (st) => {
      transactionFailure = new Error("Database unavailable");
      const log = st.mock.method(console, "error", () => {});
      const before = [...records.entries()];
      assert.equal(
        (await request("/customer/deposit", "PUT", transfer)).status,
        500,
      );
      assert.equal(log.mock.calls[0].arguments[0], transactionFailure);
      assert.deepEqual([...records.entries()], before);
    });

    await t.test("invalid stored balances are reported explicitly", async (st) => {
      records.get(key("CustomerCup", "customer-1")).cups = -1;
      const log = st.mock.method(console, "error", () => {});
      assert.equal(
        (await request("/customer/deposit", "PUT", transfer)).status,
        500,
      );
      assert.equal(log.mock.calls[0].arguments[0].message, "Stored cup balance is invalid");
      assert.equal(commands.length, 2);
    });
  } finally {
    send.mock.restore();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
