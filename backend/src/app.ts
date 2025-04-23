import express from "express";
import cors from "cors";
import routes from "./api/routes";

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors(), express.json(), express.urlencoded({ extended: true }));

app.use("/api", routes);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

export default app;
