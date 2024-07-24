require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const validateSignature = require("./src/middleware/validateSignature");

const subscriptionRoutes = require("./src/routes/subscriptionRoutes");
const notifyRoutes = require("./src/routes/notifyRoutes");
const utilityRoutes = require("./src/routes/utilityRoutes");

const app = express();
const port = process.env.PORT || 3000;

// Use Helmet to help secure your app with various HTTP headers
app.use(helmet());

// Use CORS to allow cross-origin requests
app.use(cors());

// Use body-parser middleware
app.use(bodyParser.json()); // To parse JSON bodies
app.use(bodyParser.urlencoded({ extended: true })); // To parse URL-encoded bodies

// Validiate signature-message pair
app.use(validateSignature);

// Routes
app.use("/", subscriptionRoutes);
app.use("/", notifyRoutes);
app.use("/", utilityRoutes);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
