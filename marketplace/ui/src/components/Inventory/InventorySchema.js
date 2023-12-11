import * as yup from "yup";

const getSchema = () => {
  return yup.object().shape({
    serialNumber: yup.string().optional().nullable(),
    name: yup.string().required("Name is required"),
    description: yup.string().required("Description is required"),
    artist: yup.string(),
    source: yup.string(),
    // clothingType: yup.string().nullable().required("The clothing type is required"),
    // size: yup.string().nullable().required("A size is required"),
    // skuNumber: yup.string().nullable().required("An SKU is required"),
    // condition: yup.string().nullable().required("The condition is required"),
    // brand: yup.string().nullable().required("A brand is required"),
    projectType: yup.string(),
    units: yup.number().positive("Units must be a positive number").required("Units is required"),
    expirationPeriodInMonths: yup.number().positive("Expiration period must be a positive number").required("Expiration period is required"),
    images: yup.mixed().optional().nullable(),
    price: yup.number().positive("Price must be a positive number").required("Price is required"),
    paymentTypes: yup.array().of(yup.number().positive("Payment type must be a positive number").required("Payment type is required.")).required("Payment types are required"),
    category: yup.string().required("Category is required"),
  });
};

export default getSchema;
