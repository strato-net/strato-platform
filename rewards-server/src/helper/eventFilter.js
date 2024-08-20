async function filterMessages(msg) {
  if (msg === "pong") {
    // Handle the pong message
    console.log("Received pong message");
    return false;
  }
  const event = JSON.parse(msg);
  console.log("Received event:", event?.eventEvent?.eventName);
  const allowedEvents = ["CertificateRegistered", "Order"];
  return allowedEvents.includes(event?.eventEvent?.eventName);
}

module.exports = { filterMessages };
