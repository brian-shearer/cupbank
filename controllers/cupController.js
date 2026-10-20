import database from "../services/database.js";
import {
  ScanCommand,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import cupSchemas from "../models/cupbank.js";

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function createInventory(req, res, next) {
  try {
    const { error, value } = cupSchemas.InventorySchema.validate({
      ...req.body,
      inventoryid: uuidv4(),
    });
    if (error) {
      res.status(400).json({ error: error.details[0].message });
      return;
    }
    await database.send(
      new PutCommand({
        TableName: "Inventory",
        Item: value,
        ConditionExpression: "attribute_not_exists(inventoryid)",
      }),
    );
    res.status(201).json({
      message: "Successfully created an inventory",
      data: value,
    });
  } catch (error) {
    next(error);
  }
}

async function inventoryBalance(req, res, next) {
  try {
    const result = await database.send(
      new GetCommand({
        TableName: "Inventory",
        Key: { inventoryid: req.params.locationid },
        ConsistentRead: true,
      }),
    );
    if (!result.Item) {
      throw httpError(404, "Inventory location not found");
    }
    const { inventoryid, cups } = result.Item;
    res.status(200).json({ inventoryid, cups });
  } catch (error) {
    next(error);
  }
}

async function customerBalance(req, res, next) {
  try {
    const result = await database.send(
      new GetCommand({
        TableName: "CustomerCup",
        Key: { customerid: req.params.customerid },
        ConsistentRead: true,
      }),
    );
    if (!result.Item) {
      throw httpError(404, "Customer cup record not found");
    }
    const { customerid, cups } = result.Item;
    res.status(200).json({ customerid, cups });
  } catch (error) {
    next(error);
  }
}

async function createCustomer(req, res, next) {
  try {
    const { error } = cupSchemas.customerCreateSchema.validate(req.body ?? {});
    if (error) {
      res.status(400).json({ error: error.details[0].message });
      return;
    }
    const item = { customerid: uuidv4(), cups: 0 };
    await database.send(
      new PutCommand({
        TableName: "CustomerCup",
        Item: item,
        ConditionExpression: "attribute_not_exists(customerid)",
      }),
    );
    res.status(201).json({
      message: "Successfully created a customer record",
      data: item,
    });
  } catch (error) {
    next(error);
  }
}

async function customerWithdrawal(req, res, next) {
  try {
    const { error, value } = cupSchemas.customerCupSchema.validate(req.body);
    if (error) {
      res.status(400).json({ error: error.details[0].message });
      return;
    }
    const { customerid, locationid, cups: withdrawcups } = value;
    const customerBalanceResult = await database.send(
      new GetCommand({
        TableName: "CustomerCup",
        Key: { customerid },
        ConsistentRead: true,
      }),
    );
    if (!customerBalanceResult.Item) {
      throw httpError(404, "Customer cup record not found");
    }
    const inventoryBalanceResult = await database.send(
      new GetCommand({
        TableName: "Inventory",
        Key: { inventoryid: locationid },
        ConsistentRead: true,
      }),
    );
    if (!inventoryBalanceResult.Item) {
      throw httpError(404, "Inventory location not found");
    }
    const customer = customerBalanceResult.Item;
    const inventory = inventoryBalanceResult.Item;

    console.log("Current customer cups:", customer.cups);
    console.log("Current inventory cups:", inventory.cups);

    const customerCommand = new UpdateCommand({
      TableName: "CustomerCup",
      Key: { customerid },
      UpdateExpression: "SET #cups = #cups + :withdrawcups",
      ExpressionAttributeNames: { "#cups": "cups" },
      ExpressionAttributeValues: { ":withdrawcups": withdrawcups },
      ReturnValues: "ALL_NEW",
    });
    const customerResult = await database.send(customerCommand);

    const inventoryCommand = new UpdateCommand({
      TableName: "Inventory",
      Key: { inventoryid: locationid },
      UpdateExpression: "SET #cups = #cups - :withdrawcups",
      ExpressionAttributeNames: { "#cups": "cups" },
      ExpressionAttributeValues: { ":withdrawcups": withdrawcups },
      ReturnValues: "ALL_NEW",
    });
    const inventoryResult = await database.send(inventoryCommand);

    res.status(200).json({
      message: "Withdrawal completed",
      customer: customerResult.Attributes,
      inventory: inventoryResult.Attributes,
    });
  } catch (error) {
    next(error);
  }
}

async function customerDeposit(req, res, next) {
  try {
    const { error, value } = cupSchemas.customerCupSchema.validate(req.body);
    if (error) {
      res.status(400).json({ error: error.details[0].message });
      return;
    }
    const { customerid, locationid, cups: depositcups } = value;
    const customerBalanceResult = await database.send(
      new GetCommand({
        TableName: "CustomerCup",
        Key: { customerid },
        ConsistentRead: true,
      }),
    );
    if (!customerBalanceResult.Item) {
      throw httpError(404, "Customer cup record not found");
    }
    const inventoryBalanceResult = await database.send(
      new GetCommand({
        TableName: "Inventory",
        Key: { inventoryid: locationid },
        ConsistentRead: true,
      }),
    );
    if (!inventoryBalanceResult.Item) {
      throw httpError(404, "Inventory location not found");
    }
    const customer = customerBalanceResult.Item;
    const inventory = inventoryBalanceResult.Item;

    console.log("Current customer cups:", customer.cups);
    console.log("Current inventory cups:", inventory.cups);

    const customerCommand = new UpdateCommand({
      TableName: "CustomerCup",
      Key: { customerid },
      UpdateExpression: "SET #cups = #cups - :depositcups",
      ExpressionAttributeNames: { "#cups": "cups" },
      ExpressionAttributeValues: { ":depositcups": depositcups },
      ReturnValues: "ALL_NEW",
    });
    const customerResult = await database.send(customerCommand);

    const inventoryCommand = new UpdateCommand({
      TableName: "Inventory",
      Key: { inventoryid: locationid },
      UpdateExpression: "SET #cups = #cups + :depositcups",
      ExpressionAttributeNames: { "#cups": "cups" },
      ExpressionAttributeValues: {
        ":depositcups": depositcups,
      },
      ReturnValues: "ALL_NEW",
    });
    const inventoryResult = await database.send(inventoryCommand);

    res.status(200).json({
      message: "Deposit completed",
      customer: customerResult.Attributes,
      inventory: inventoryResult.Attributes,
    });
  } catch (error) {
    next(error);
  }
}

async function deleteCustomerById(req, res, next) {
  try {
    await database.send(
      new DeleteCommand({
        TableName: "CustomerCup",
        Key: { customerid: req.params.customerid },
        ConditionExpression: "attribute_exists(customerid)",
      }),
    );
    res.status(204).end();
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      next(httpError(404, "Customer cup record not found"));
      return;
    }
    next(error);
  }
}

export default {
  createInventory,
  inventoryBalance,
  createCustomer,
  customerBalance,
  customerWithdrawal,
  customerDeposit,
  deleteCustomerById,
};
