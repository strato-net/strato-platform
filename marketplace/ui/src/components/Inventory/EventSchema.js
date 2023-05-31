import * as yup from "yup";

const getSchema = () => {
  return yup.object().shape({
    eventType: yup.object().shape({
      name: yup.string().required("Event type is required").nullable(),
    }),
    certifier: yup.object().shape({
      name: yup.string().nullable().notRequired(),
    }),
    date: yup.date().required("Date is required").nullable(),
    summary: yup.string().required("Summary is required"),
    serialNumber: yup.object().shape({
      serialNumStr: yup.string().required("Serial Number is required").nullable(),
    })
  });
};

export default getSchema;
