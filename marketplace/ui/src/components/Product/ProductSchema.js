import * as yup from "yup";

const getSchema = () => {
  return yup.object().shape({
    image: yup.mixed().required("Product image is required"),
    name: yup.string().required("Product name is required"),
    category: yup.object().shape({
      name: yup.string().required("Category is required").nullable(),
    }),
    description: yup.string().required("Description is required"),
    active: yup.boolean().required("Active status is required"),
  });
};

export default getSchema;
