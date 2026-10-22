import express from "express";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { pathToFileURL } from "node:url";
import database from "./services/database.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function scanTable(databaseClient, tableName) {
  const items = [];
  let lastEvaluatedKey;

  do {
    const result = await databaseClient.send(
      new ScanCommand({
        TableName: tableName,
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
      }),
    );
    items.push(...(result.Items ?? []));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}

function inventoryRows(inventories) {
  if (inventories.length === 0) {
    return '<tr><td colspan="3" class="empty">No inventory records found.</td></tr>';
  }

  return inventories
    .sort((a, b) =>
      String(a.inventoryid ?? "").localeCompare(String(b.inventoryid ?? "")),
    )
    .map(
      (inventory) => `
        <tr>
          <td>${escapeHtml(inventory.inventoryid)}</td>
          <td>${escapeHtml(inventory.description || "-")}</td>
          <td class="balance">${escapeHtml(inventory.cups)}</td>
        </tr>`,
    )
    .join("");
}

function customerRows(customers) {
  if (customers.length === 0) {
    return '<tr><td colspan="2" class="empty">No customer records found.</td></tr>';
  }

  return customers
    .sort((a, b) =>
      String(a.customerid ?? "").localeCompare(String(b.customerid ?? "")),
    )
    .map(
      (customer) => `
        <tr>
          <td>${escapeHtml(customer.customerid)}</td>
          <td class="balance">${escapeHtml(customer.cups)}</td>
        </tr>`,
    )
    .join("");
}

function renderPage(inventories, customers) {
  const inventoryTotal = inventories.reduce(
    (total, item) => total + (Number(item.cups) || 0),
    0,
  );
  const customerTotal = customers.reduce(
    (total, item) => total + (Number(item.cups) || 0),
    0,
  );

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Cupbank balances</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
        color: #17211b;
        background: #f2f5f2;
      }
      * { box-sizing: border-box; }
      body { margin: 0; }
      main { width: min(1100px, calc(100% - 32px)); margin: 48px auto; }
      header {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 28px;
      }
      h1 { margin: 0 0 6px; font-size: clamp(2rem, 5vw, 3.2rem); }
      p { margin: 0; color: #607066; }
      .refresh {
        display: inline-block;
        padding: 10px 16px;
        border-radius: 999px;
        color: white;
        background: #176b45;
        font-weight: 700;
        text-decoration: none;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin-bottom: 24px;
      }
      .metric, section {
        border: 1px solid #dce4de;
        border-radius: 18px;
        background: white;
        box-shadow: 0 10px 30px rgb(23 33 27 / 6%);
      }
      .metric { padding: 20px; }
      .metric span { display: block; color: #607066; font-size: .9rem; }
      .metric strong { display: block; margin-top: 6px; font-size: 1.8rem; }
      .tables { display: grid; grid-template-columns: 1.2fr 1fr; gap: 24px; }
      section { overflow: hidden; }
      h2 { margin: 0; padding: 20px 22px; font-size: 1.2rem; }
      table { width: 100%; border-collapse: collapse; }
      th, td {
        padding: 14px 22px;
        border-top: 1px solid #edf0ed;
        text-align: left;
        overflow-wrap: anywhere;
      }
      th {
        color: #607066;
        background: #fafbfa;
        font-size: .78rem;
        letter-spacing: .06em;
        text-transform: uppercase;
      }
      .balance { font-variant-numeric: tabular-nums; font-weight: 700; }
      .empty { padding: 28px 22px; color: #607066; text-align: center; }
      @media (max-width: 760px) {
        main { margin: 28px auto; }
        header { align-items: start; flex-direction: column; }
        .summary, .tables { grid-template-columns: 1fr; }
        th, td { padding: 12px 14px; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>Cupbank balances</h1>
          <p>Current inventory and customer balances from DynamoDB.</p>
        </div>
        <a class="refresh" href="/">Refresh data</a>
      </header>

      <div class="summary">
        <div class="metric">
          <span>Inventory cups across ${inventories.length} locations</span>
          <strong>${escapeHtml(inventoryTotal)}</strong>
        </div>
        <div class="metric">
          <span>Customer cups across ${customers.length} customers</span>
          <strong>${escapeHtml(customerTotal)}</strong>
        </div>
      </div>

      <div class="tables">
        <section>
          <h2>Inventories</h2>
          <table>
            <thead>
              <tr><th>Inventory ID</th><th>Description</th><th>Balance</th></tr>
            </thead>
            <tbody>${inventoryRows(inventories)}</tbody>
          </table>
        </section>

        <section>
          <h2>Customers</h2>
          <table>
            <thead>
              <tr><th>Customer ID</th><th>Balance</th></tr>
            </thead>
            <tbody>${customerRows(customers)}</tbody>
          </table>
        </section>
      </div>
    </main>
  </body>
</html>`;
}

export function createDashboardApp(databaseClient = database) {
  const app = express();

  app.get("/", async (req, res, next) => {
    try {
      const [inventories, customers] = await Promise.all([
        scanTable(databaseClient, "Inventory"),
        scanTable(databaseClient, "CustomerCup"),
      ]);
      res.type("html").send(renderPage(inventories, customers));
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    console.error(error);
    res
      .status(500)
      .type("html")
      .send("<h1>Unable to load Cupbank balances</h1><p>Please try again.</p>");
  });

  return app;
}

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const port = Number(process.env.DASHBOARD_PORT) || 3001;
  createDashboardApp().listen(port, () => {
    console.log(`Cupbank dashboard: http://localhost:${port}`);
  });
}
