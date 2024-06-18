export const status = {
  1: "Awaiting Fulfillment",
  2: "Payment Pending",
  3: "Closed",
  4: "Canceled",
};

export const statusByName = {
  "Awaiting Fulfillment": "Awaiting Fulfillment",
  "Payment Pending": "Payment Pending",
  "Closed": "Closed",
  "Canceled": "Canceled",
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
