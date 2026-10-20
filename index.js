import dotenv from "dotenv";
dotenv.config();
import app from "./app.js";

const port = process.env.PORT;
async function startServer() {
  try {
    app.listen(port, () => console.log(`🤖 Listening on Port: ${port}`));
  } catch (err) {
    console.log("🤖 Oh no something went wrong", err);
  }
}

startServer();
