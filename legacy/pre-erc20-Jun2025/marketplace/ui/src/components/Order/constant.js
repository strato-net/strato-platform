export const status = {
  1: 'Awaiting Fulfillment',
  2: 'Payment Pending',
  3: 'Closed',
  4: 'Canceled',
  5: 'Discarded',
};

export const statusByName = {
  'Awaiting Fulfillment': 'Awaiting Fulfillment',
  'Payment Pending': 'Payment Pending',
  Closed: 'Closed',
  Canceled: 'Canceled',
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

export const TYPE_COLOR = {
  Order: '#2A53FF',
  Transfer: '#FF0000',
  Redemption: '#001C76',
};

export const TRANSACTION_FILTER = [
  { value: '', label: 'All' },
  { value: 'Order', label: 'Order' },
  { value: 'Transfer', label: 'Transfer' },
  { value: 'Redemption', label: 'Redemption' },
  { value: 'Stake', label: 'Stake' },
  { value: 'Unstake', label: 'Unstake' },
  { value: 'USDST', label: 'USDST' },
];
