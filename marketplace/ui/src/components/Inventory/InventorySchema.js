import * as yup from "yup";

const getSchema = () => {
  return yup.object().shape({
    serialNumber: yup.string().optional().nullable(),
    name: yup.string().required("Name is required"),
    description: yup.string().required("Description is required"),
    artist: yup.string(),
    source: yup.string().required("Enter Source"),
    unitOfMeasurement: yup.object().shape({
      name: yup.string().required("Measurement Name is required"),
      value: yup.number().positive("Measurement Value must be a positive number").required("Measurement Value is required"),
    }).required("Measurement Unit Required"),
    purity: yup.string().required("Enter Purity"),
    // clothingType: yup.string().nullable().required("The clothing type is required"),
    // size: yup.string().nullable().required("A size is required"),
    // skuNumber: yup.string().nullable().required("An SKU is required"),
    // condition: yup.string().nullable().required("The condition is required"),
    // brand: yup.string().nullable().required("A brand is required"),
    quantity: yup.number().positive("Quantity must be a positive number").required("Quantity is required"),
    expirationPeriodInMonths: yup.number().positive("Expiration period must be a positive number").required("Expiration period is required"),
    images: yup.mixed().optional().nullable(),
    files: yup.mixed().optional().nullable(),
    category: yup.string().required("Category is required"),
  });
};

export default getSchema;
