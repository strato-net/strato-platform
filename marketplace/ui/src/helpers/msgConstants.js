export const UPLOAD_ERROR = {
  nameErr: 'File name must be less than 100 characters',
  sizeErr: 'Cannot upload image files of total size more than 5mb',
  formatErr: 'Image must be of jpeg or png format',
};

export const TOAST_MSG = {
  ITEM_ADDED_TO_CART: 'Item added to cart',
  ITEM_UPDATED_IN_CART: 'Item updated in cart',
  CANNOT_BUY_OWN_ITEM: 'Cannot buy your own item',
  OUT_OF_STOCK: (product) =>
    `Unfortunately, ${product.name} is currently out of stock. We recommend checking back soon or browsing similar items available now.`,
  TOO_MUCH_QUANTITY: (checkQuantity, product) =>
    `Unfortunately, only ${checkQuantity[0].availableQuantity} units of ${product.name} are available. Please update your cart quantity accordingly.`,
};
