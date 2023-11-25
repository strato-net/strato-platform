import { AMEX, Discover, Mastercard, VISA } from "../images/SVGComponents";

export const apiUrl = process.env.REACT_APP_URL
  ? process.env.REACT_APP_URL + "/api/v1"
  : "/api/v1";

export const cirrusUrl = process.env.REACT_APP_URL
  ? process.env.REACT_APP_URL + "/cirrus/search"
  : "/cirrus/search"

export const HTTP_METHODS = {
  GET: "GET",
  POST: "POST",
  PATCH: "PATCH",
  PUT: "PUT",
};

export const UNIT_OF_MEASUREMENTS = {
  1: "LB",
  2: "Ounce",
  3: "Ton",
  4: "Bag",
  5: "Box",
  6: "Piece",
  7: "Bale",
  8: "Gallon",
  9: "Pound",
  10: "Yard",
  11: "Kilogram"
};

export const US_DATE_FORMAT = "MM/DD/YYYY";

export const MAX_QUANTITY = 1000000;
export const MAX_PRICE = 100000000;

export const INVENTORY_STATUS = {
  PUBLISHED: 1,
  UNPUBLISHED: 2,
  "1": "Published",
  "2": "Unpublished",
};

export const unitOfMeasures = [
  { name: "LB", value: 1 },
  { name: "Ounce", value: 2 },
  { name: "Ton", value: 3 },
  { name: "Bag", value: 4 },
  { name: "Box", value: 5 },
  { name: "Piece", value: 6 },
  { name: "Bale", value: 7 },
  { name: "Gallon", value: 8 },
  { name: "Pound", value: 9 },
  { name: "Yard", value: 10 },
  { name: "Kilogram", value: 11 }
];

export const CHARGES = {
  "SHIPPING": 0,
  "TAX": 0
}
export const MAX_RAW_MATERIAL = 8;


export const STATUS_FILTER = [
  {
    text: "Pending",
    value: "Pending",
  },
  {
    text: "Approved",
    value: "Approved",
  },
  {
    text: "Rejected",
    value: "Rejected",
  },
];

export const STATUS = {
  0: "",
  1: "Pending",
  2: "Approved",
  3: "Rejected",
  "Pending": 1,
  "Approved": 2,
  "Rejected": 3
};

export const APPROVAL_STATUS = {
  1: "Accept",
  2: "Reject",
  "Accept": 1,
  "Reject": 2,
};

export const CATEGORIES = [
  "Art",
  "Carbon",
  "Metals",
  "Clothing"
]

export const PAYMENT_TYPE = [
  { name: "---SELECT ALL---", value: 0},
  { name: "AMEX", value: 1, icon: <AMEX width="20px" height="14px"/> },
  { name: "Discover", value: 2, icon: <Discover width="20px" height="14px"/> },
  { name: "Mastercard", value: 3, icon: <Mastercard width="20px" height="14px"/> },
  { name: "STRAT", value: 4 },
  { name: "VISA", value: 5, icon: <VISA width="20px" height="14px"/> },
]