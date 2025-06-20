import * as yup from 'yup';

const getSchema = () => {
  return yup.object().shape({
    image: yup.mixed().required('Product image is required'),
    name: yup.string().required('Product name is required'),
    category: yup.object().shape({
      name: yup.string().required('Category is required').nullable(),
    }),
    subCategory: yup.object().shape({
      name: yup.string().required('Sub-Category is required').nullable(),
    }),
    manufacturer: yup.string().required('Manufacturer name is required'),
    unitofmeasurement: yup.object().shape({
      name: yup.string().required('Unit of measurement is required').nullable(),
    }),
    leastSellableUnit: yup
      .number()
      .positive('LSU must be a positive number')
      .required('LSU is required'),
    description: yup.string().required('Description is required'),
    active: yup.boolean().required('Active status is required'),
    userUniqueProductCode: yup
      .string()
      .test(
        'no-double-quotes',
        'Unique product code cannot contain double quotes',
        (value) => {
          return value === undefined || !value.includes('"');
        }
      ),
  });
};

export default getSchema;
