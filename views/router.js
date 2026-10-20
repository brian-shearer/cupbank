import express from "express";
import cupController from "../controllers/cupController.js";

const Router = express.Router();

Router.route("/cupbank/inventory/:locationid").get(
  cupController.inventoryBalance,
);
Router.route("/cupbank/inventory").post(cupController.createInventory);

Router.route("/cupbank/customer").post(cupController.createCustomer);

Router.route("/cupbank/customer/:customerid")
  .get(cupController.customerBalance)
  .delete(cupController.deleteCustomerById);

Router.route("/cupbank/customer/deposit").put(cupController.customerDeposit);
Router.route("/cupbank/customer/withdrawal").put(
  cupController.customerWithdrawal,
);

export default Router;
