import * as yup from "yup";

const getSchema = () => {
  return yup.object().shape({
    serialNumber: yup.string().optional().nullable(),
    name: yup.string().required("Name is required"),
    description: yup.string().required("Description is required"),
    artist: yup.string(),
    source: yup.string(),
    brand: yup.string(),
    projectType: yup.string(),
    images: yup.mixed().optional().nullable(),
    price: yup.number().positive("Price must be a positive number").required("Price is required"),
    paymentTypes: yup.array().of(yup.number().positive("Payment type must be a positive number").required("Payment type is required.")).required("Payment types are required"),
    category: yup.string().required("Category is required"),
  });
};

export default getSchema;
