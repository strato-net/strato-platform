import { REDEMPTION_STATUS } from "../../helpers/constants";

export const status = {
  1: "Awaiting Fulfillment",
  2: "Payment Pending",
  3: "Closed",
  4: "Canceled",
  5: "Discarded"
};

export const statusByName = {
  "Awaiting Fulfillment": "Awaiting Fulfillment",
  "Payment Pending": "Payment Pending",
  "Closed": "Closed",
  "Canceled": "Canceled",
};

export const STATUS_CLASSES = {
  "Awaiting Shipment": {
    textClass: "bg-[#EBF7FF]",
    bgClass: "bg-[#13188A]"
  },
  "Awaiting Fulfillment": {
    textClass: "bg-[#FF8C0033]",
    bgClass: "bg-[#FF8C00]"
  },
  "Payment Pending": {
    textClass: "bg-[#FF8C0033]",
    bgClass: "bg-[#FF8C00]"
  },
  "Closed": {
    textClass: "bg-[#119B2D33]",
    bgClass: "bg-[#119B2D]"
  },
  "Canceled": {
    textClass: "bg-[#FFF0F0]",
    bgClass: "bg-[#FF0000]"
  },
  "Processing": {
    textClass: "bg-[#FF8C0033]",
    bgClass: "bg-[#FF8C00]"
  },
  "Paid": {
    textClass: "bg-[#119B2D33]",
    bgClass: "bg-[#119B2D]"
  },
  "Payment Failed": {
    textClass: "bg-[#FFF0F0]",
    bgClass: "bg-[#FF0000]"
  },
  [REDEMPTION_STATUS.PENDING]: {
    textClass: "bg-[#FF8C0033]",
    bgClass: "bg-[#FF8C00]"
  },
  [REDEMPTION_STATUS.REJECTED]: {
    textClass: "bg-[#FFF0F0]",
    bgClass: "bg-[#FF0000]"
  },
  [REDEMPTION_STATUS.FULFILLED]: {
    textClass: "bg-[#119B2D33]",
    bgClass: "bg-[#119B2D]"
  }
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

export const SORT_OPTIONS = [
  { id: 0, label: 'All' },
  { id: 1, label: 'Awaiting Fulfillment' },
  { id: 2, label: 'Awaiting Shipment' },
  { id: 3, label: 'Closed' },
  { id: 4, label: 'Canceled' },
  { id: 5, label: 'Payment Pending' },
];

export const MENU_ITEMS = [
  {
    key: 'xls',
    label: 'Excel',
  },
  {
    key: 'csv',
    label: 'CSV',
  },
];
