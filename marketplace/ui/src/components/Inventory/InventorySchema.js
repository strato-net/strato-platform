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
    quantity: yup.number().positive("Quantity must be a positive number").required("Quantity is required"),
    images: yup.mixed().optional().nullable(),
    files: yup.mixed().optional().nullable(),
    category: yup.string().required("Category is required"),
  });
};

export default getSchema;
