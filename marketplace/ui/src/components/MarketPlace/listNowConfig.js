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
        isStatusVisible: false
      };
    case "AddInventory":
      return {
        title: "Create / Edit Listing",
        isCreate: true,
        isEdit: false,
        listType: "New",
        api: "createMembership",
        isMembershipNumber: false,
        quantityDisabled: false,
        priceDisabled: false,
        statusDropDown: true,
        isStatusVisible: true
      };
    case "editInventory":
      return {
        title: "Create / Edit Listing",
        isCreate: true,
        isEdit: false,
        listType: "New",
        api: "createMembership",
        isMembershipNumber: false,
        quantityDisabled: true,
        priceDisabled: false,
        statusDropDown: true,
        isStatusVisible: true
      };
    case "resaleMembership":
      return {
        title: "Create / Edit Listing",
        isCreate: true,
        isEdit: false,
        listType: "New",
        api: "createMembership",
        isMembershipNumber: true,
        quantityDisabled: true,
        priceDisabled: false,
        statusDropDown: true,
        isStatusVisible: true
      };
    default:
      return {}; // Default case
  }
};
