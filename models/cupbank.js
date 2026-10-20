import Joi from "joi";

const InventorySchema = Joi.object({
  inventoryid: Joi.string().required(),
  description: Joi.string().required(),
  cups: Joi.number().integer().min(0).required(),
}).required();

const customerCreateSchema = Joi.object({});

const customerCupSchema = Joi.object({
  customerid: Joi.string().required(),
  locationid: Joi.string().required(),
  cups: Joi.number().integer().positive().required(),
}).required();

export default {
  InventorySchema,
  customerCreateSchema,
  customerCupSchema,
};
