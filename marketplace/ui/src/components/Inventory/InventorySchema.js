import * as yup from "yup";

const getSchema = () => {
  return yup.object().shape({
    category: yup.object().shape({
      name: yup.string().required("Category is required").nullable(),
    }),
    subCategory: yup.object().shape({
      name: yup.string().required("Sub-Category is required").nullable(),
    }),
    productName: yup.object().shape({
      name: yup.string().required("Product Name is required").nullable(),
    }),
    quantity: yup.number().required("Quantity is required").nullable(),
    pricePerUnit: yup.number().required("Price per unit is required"),
    batchId: yup.string().required("Batch ID is required").test('no-double-quotes', 'Batch ID cannot contain double quotes', value => {
      return value === undefined || !value.includes('"');
    }),
    status: yup.boolean().required("Status is required"),
    serialNumber: yup.object().shape({
      serialNumStr: yup
        .string()
        .optional()
        .nullable(),
      serialNumArr: yup.array()
        .optional()
        .of(
          yup.object({
            itemSerialNumber: yup.string().required("Serial Number is required"),
            rawMaterials: yup.array()
              .required("Raw material is required")
              .of(
                yup.object({
                  rawMaterialProductName: yup.string().required("Raw material product name is required"),
                  rawMaterialProductId: yup.string().required("Raw material product code is required"),
                  rawMaterialSerialNumbers: yup.array()
                    .required("Raw material serial number is required")
                    .of(yup.string())
                })
              )
          })
        )
    }),
  });
};

export default getSchema;
