const commonFields = [
  {
    key: "seller",
    label: "Seller",
    type: "input",
    size: "large",
    disabled: true,
    hidden: false,
  },
  {
    key: "membership",
    label: "Membership",
    type: "input",
    size: "large",
    disabled: true,
    hidden: false,
  },
  {
    key: "membershipNumber",
    label: "Membership Number",
    type: "input",
    size: "large",
    disabled: true,
    hidden: true,
  },
  {
    key: "quantity",
    label: "Quantity",
    type: "inputNumber",
    size: "large",
    disabled: false,
    hidden: false,
  },
  {
    key: "taxPercentage",
    label: "Tax Percentage/Amount",
    type: "inputNumber",
    size: "large",
    disabled: false,
    hidden: false,
    min: 0,
    step: 1,
    precision: 0,
    addOn: true,
  },
  {
    key: "price",
    label: "Price",
    type: "inputNumber",
    size: "large",
    disabled: false,
    hidden: false,
    addonBefore: "$",
    min: 0,
  },
  {
    key: "inventoryStatus",
    label: "Status",
    type: "select",
    size: "large",
    hidden: false,
    // dropdownOptions: statusOptions,
    defaultValue: 1, // Default selected value
  },
];

export const listNowConfig = (caseType) => {
  switch (caseType) {
    case "create":
      return {
        title: "Create Listing",
        isCreate: true,
        isEdit: false,
        listType: "New",
        api: "createMembership",
        isMembershipNumber: false,
        quantityDisabled: false,
        priceDisabled: false,
        statusDropDown: false,
        isStatusVisible: false,
        fields: commonFields,
      };
    case "AddInventory":
    case "editInventory":
    case "resaleMembership":
      return {
        title: "Create / Edit Listing",
        isCreate: true,
        isEdit: false,
        listType: "New",
        api: "createMembership",
        isMembershipNumber: caseType === "resaleMembership",
        quantityDisabled: caseType === "editInventory" || caseType === "resaleMembership",
        priceDisabled: false,
        statusDropDown: true,
        isStatusVisible: true,
        fields: commonFields,
      };
    default:
      return {}; // Default case
  }
};
