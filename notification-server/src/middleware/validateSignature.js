const crypto = require("crypto");
const secp256k1 = require("secp256k1");

/**
 * Converts a hexadecimal string to a Uint8Array.
 * @param {string} hex - The hexadecimal string.
 * @returns {Uint8Array} - The resulting Uint8Array.
 */
function hexToUint8Array(hex) {
  return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
}

/**
 * Middleware to validate the signature of a message.
 * @param {Object} req - The Express request object.
 * @param {Object} res - The Express response object.
 * @param {Function} next - The next middleware function.
 */
const validateSignature = (req, res, next) => {
  console.log(req.body);
  const { signature, message, timestamp, msgHash } = req.body;

  // Check if the required fields are present
  if (!signature || !message || !timestamp || !msgHash) {
    return res.status(400).send("Bad Request: Missing signature, message, timestamp, or msgHash");
  }

  const { subject, htmlContent } = message;

  // Recreate the data string to be hashed
  const dataToHash = subject + htmlContent + timestamp;

  // Hash the concatenated string to verify against msgHash
  const msgHashCheck = crypto.createHash("sha256").update(dataToHash).digest("hex");

  // Compare the received msgHash with the newly computed hash
  if (msgHash !== msgHashCheck) {
    return res.status(400).send("Bad Request: Invalid message hash");
  }

  // Check if the timestamp is within the allowed time frame (30 seconds)
  const currentTime = Date.now();
  const messageTime = new Date(timestamp).getTime();
  console.log("Current time: ", currentTime);
  console.log("Message time: ", messageTime);
  if (currentTime - messageTime > 30000) {
    return res.status(400).send("Bad Request: Invalid timestamp");
  }

  const { r, s, v } = signature;

  // Validate the format of the signature
  if (!r || !s || v === undefined) {
    return res.status(400).send("Bad Request: Invalid signature format");
  }

  // Convert r and s to Uint8Array
  const rArray = hexToUint8Array(r);
  const sArray = hexToUint8Array(s);
  const recid = v; // Recovery identifier

  // Concatenate r and s to form the signature Uint8Array
  const signatureArray = new Uint8Array([...rArray, ...sArray]);

  try {
    // Convert msgHash to Uint8Array
    const msgHashArray = hexToUint8Array(msgHash);

    // Recover the public key from the signature
    const publicKey = secp256k1.ecdsaRecover(signatureArray, recid, msgHashArray);
    console.log("Recovered public key: ", publicKey);
    
    // Verify the signature with the public key
    const isValid = secp256k1.ecdsaVerify(signatureArray, msgHashArray, publicKey);
    console.log("Signature valid: ", isValid);

    if (!isValid) {
      return res.status(400).send("Bad Request: Invalid signature");
    }
  } catch (error) {
    console.error("Error during signature validation: ", error);
    return res.status(500).send("Internal Server Error: Signature validation failed");
  }

  // If the signature is valid, proceed to the next middleware or route handler
  next();
};

module.exports = validateSignature;
