import * as yup from "yup";

const getSchema = () => {
  return yup.object().shape({
    serialNumber: yup.string().optional().nullable(),
    name: yup.string().required("Name is required"),
    description: yup.string().required("Description is required"),
    artist: yup.string(),
    source: yup.string(),
    unitOfMeasurement: yup.object().shape({
      name: yup.string(),
      value: yup.number().positive("Measurement Value must be a positive number"),
    }),
    purity: yup.string(),
    // clothingType: yup.string().nullable().required("The clothing type is required"),
    // size: yup.string().nullable().required("A size is required"),
    // skuNumber: yup.string().nullable().required("An SKU is required"),
    // condition: yup.string().nullable().required("The condition is required"),
    // brand: yup.string().nullable().required("A brand is required"),
    quantity: yup.number().positive("Quantity must be a positive number").required("Quantity is required"),
    expirationPeriodInMonths: yup.number().positive("Expiration period must be a positive number").required("Expiration period is required"),
    images: yup.mixed().required("Image is required"),
    files: yup.mixed().optional().nullable(),
    category: yup.string().required("Category is required"),
    subCategory: yup.string().nullable().required("Sub-Category is required")
  });
};

export default getSchema;
