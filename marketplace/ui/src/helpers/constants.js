export const apiUrl = process.env.REACT_APP_URL
  ? process.env.REACT_APP_URL + "/api/v1"
  : "/api/v1";

export const HTTP_METHODS = {
  GET: "GET",
  POST: "POST",
  PATCH: "PATCH",
  PUT: "PUT",
};

export const US_DATE_FORMAT = "MM/DD/YYYY";

export const MAX_QUANTITY = 1000000;
export const MAX_PRICE = 100000000;

export const INVENTORY_STATUS = {
  PUBLISHED: 1,
  UNPUBLISHED: 2,
  1: "Published",
  2: "Unpublished",
};

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
    "Pending" : 1,
    "Approved" : 2,
    "Rejected" : 3
  };

  export const APPROVAL_STATUS = {
    1: "Accept",
    2: "Reject",
    "Accept" : 1,
    "Reject" : 2,
  };