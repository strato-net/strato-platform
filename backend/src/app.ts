import express from "express";
import cors from "cors";
import routes from "./api/routes";

const app = express();
app.use(cors(), express.json());

app.use("/api", routes);

export default app;
