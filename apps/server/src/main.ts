import { createRunServer } from "./app.js";

const host = "127.0.0.1";
const port = 8787;

createRunServer().listen(port, host, () => {
  console.log(`Fine Print server listening on http://${host}:${port}`);
});
