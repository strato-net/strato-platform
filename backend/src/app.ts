import express from "express";
import cors from "cors";
import routes from "./api/routes";

const app = express();
app.use(cors(), express.json());

app.use("/api", routes);

app.listen(3000, () => {
    console.log(`Server running at http://localhost:${3000}`);
  });
  

export default app;
