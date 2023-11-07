import * as yup from "yup";

const getSchema = () => {
  return yup.object().shape({
    serialNumber: yup.string().optional().nullable(),
    itemNumber: yup.number().positive("Item number must be a positive number").required("Item number is required"),
    name: yup.string().required("Name is required"),
    description: yup.string().required("Description is required"),
    artist: yup.string(),
    source: yup.string(),
    brand: yup.string(),
    projectType: yup.string(),
    images: yup.mixed().optional().nullable(),
    price: yup.number().positive("Price must be a positive number").required("Price is required"),
    paymentType: yup.string().required("Payment type is required"),
    category: yup.string().required("Category is required"),
  });
};

export default getSchema;
