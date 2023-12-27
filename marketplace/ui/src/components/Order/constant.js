export const status = {
  1: "Awaiting Fulfillment",
  2: "Awaiting Shipment",
  3: "Closed",
  4: "Canceled",
  5: "Payment Pending"
};

export const statusByName = {
  "Awaiting Fulfillment": "Awaiting Fulfillment",
  "Awaiting Shipment": "Awaiting Shipment",
  "Closed": "Closed",
  "Canceled": "Canceled",
  "Payment Pending": "Payment Pending"
};

export const getStatusByName = (name) => {
  return statusByName[`${name}`];
};

export const getStatus = (num) => {
  return status[`${num}`];
};

export const getStatusByValue = (value) => {
  return Object.keys(status).find((key) => status[key] === value);
};
