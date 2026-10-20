provider "aws" {
  region = "us-east-1"
}

resource "aws_dynamodb_table" "inventory" {
  name         = "Inventory"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "inventoryid"

  attribute {
    name = "inventoryid"
    type = "S"
  }

  tags = {
    Name = "InventoryTable"
  }
}


resource "aws_dynamodb_table" "customercup" {
  name         = "CustomerCup"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "customerid"

  attribute {
    name = "customerid"
    type = "S"
  }

  tags = {
    Name = "CustomerCupsTable"
  }
}