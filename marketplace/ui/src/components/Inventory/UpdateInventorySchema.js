import * as yup from "yup";

const getSchema = () => {
  return yup.object().shape({
    category: yup.object().shape({
      name: yup.string().required("Category is required").nullable(),
    }),
    productName: yup.object().shape({
      name: yup.string().required("Product Name is required").nullable(),
    }),
    availableQuantity: yup.number().required("Quantity is required").nullable(),
    pricePerUnit: yup.number().required("Price per unit is required"),
    vintage: yup.number().required("Vintage is required"),
    status: yup.boolean().required("Status is required"),
  });
};

export default getSchema;
