import { env } from "../../../../env";

export const validate = (values) => {
  const errors = {};

  if (!values.from) {
    errors.value = 'Please select a user';
  }

  if (!values.fromAddress) {
    errors.value = 'Please select a address';
  }

  if (env.OAUTH_ENABLED && !values.address) {
    errors.value = "Please enter address"
  }

  if (!env.OAUTH_ENABLED) {

    if (!values.password) {
      errors.value = 'Please enter a password';
    }
    if (!values.radio && !values.toAddress) {
      errors.value = "Please select address"
    }

    if (values.radio === "0" && !values.toAddress) {
      errors.value = "Please select address"
    }

    if (values.radio === "1" && !values.address) {
      errors.value = "Please enter address"
    }
  }

  if (!values.value) {
    errors.value = 'Please enter a value';
  }

  return errors;
};

export default validate;
