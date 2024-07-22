require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const { rest, fsUtil } = require('blockapps-rest');
const { jwtDecode } = require('jwt-decode');
const subscriptionRoutes = require("./src/routes/subscriptionRoutes");
const notifyRoutes = require("./src/routes/notifyRoutes");

const config = fsUtil.getYaml('config.yaml');

const app = express();
const port = process.env.PORT || 3000;

// Use Helmet to help secure your app with various HTTP headers
app.use(helmet());

// Use CORS to allow cross-origin requests
app.use(cors());

// Use body-parser middleware
app.use(bodyParser.json()); // To parse JSON bodies
app.use(bodyParser.urlencoded({ extended: true })); // To parse URL-encoded bodies

// Function to check if the token is expired
const unixTime = (date) => Math.floor(date.getTime() / 1000);

const isTokenExpired = (decodedToken, tokenLifetimeReserveSeconds = 60) => {
  return decodedToken["exp"] <= (unixTime(new Date()) + tokenLifetimeReserveSeconds);
};

// Middleware for token decoding and address fetching
app.use(async (req, res, next) => {
  try {
    const token = req.headers.authorization;
    if (!token) {
      return res.status(401).json({ error: 'Authorization token missing' });
    }
    console.log("token: ", token);

    const decodedToken = jwtDecode(token);
    console.log("decodedToken: ", decodedToken);
    
    if (isTokenExpired(decodedToken)) {
      return res.status(401).json({ error: 'Authorization token expired' });
    }

    const address = await rest.getKey({ username: decodedToken.preferred_username, token }, { config });
    
    if (address === '8c945210bbedf90a0c54d0e68357398586c865c3') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    console.log("address: ", address);

    next();
  } catch (error) {
    console.error('Error decoding token or fetching address:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Routes
app.use("/api", subscriptionRoutes);
app.use("/api", notifyRoutes);

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
