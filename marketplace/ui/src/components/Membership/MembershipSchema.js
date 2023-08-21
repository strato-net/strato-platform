import * as yup from "yup";

const getSchema = (isListNowModalOpen) => {
  return yup.object().shape({
    // The images array needs to have at least one image. We can use the min method to check for this.
    images: yup.array().min(1).required("At least one image is required"),
    name: yup.string().required("Membership name is required"),
    subCategory: yup.string().required("Sub Category is required"),
    description: yup.string().required("Description is required"),
    additionalInformation: yup
      .string()
      .required("Additional Information is required"),
    duration: yup.number().required("Duration is required"),
    price: yup.number().when("isListNowModalOpen", {
        is: () => isListNowModalOpen, // Use a function to evaluate the condition
        then: yup.number().required("Price is required"),
      }),
      quantity: yup.number().when("isListNowModalOpen", {
        is: () => isListNowModalOpen, // Use a function to evaluate the condition
        then: yup.number().required("Quantity is required"),
      }),
    services: yup.array().of(
      yup.object().shape({
        serviceName: yup.string().required("Service Name is required"),
        // We need either discountPrice or percentDiscount. If one of these if provided its okay. If none are provided we need to say we need one of them to be provided.
        memberPrice: yup
        .number()
        .test("priceOrPercentRequired", "Discount Price or Percent required", function (value) {
          const percentDiscount = this.parent.percentDiscount;
    
          if (!value && !percentDiscount) {
            return false;
          }
    
          return true;
        })
        .nullable(),
      percentDiscount: yup
        .number()
        .test("priceOrPercentRequired", "Discount Price or Percent required", function (value) {
          const memberPrice = this.parent.memberPrice;
    
          if (!value && !memberPrice) {
            return false;
          }
    
          return true;
        })
        .nullable(),
        numberOfUses: yup.number().required("Number of Uses is required"),
      })
    ),
    documents: yup.array().optional(),
  });
};

export default getSchema;
