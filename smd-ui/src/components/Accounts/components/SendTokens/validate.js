import { isOauthEnabled } from "../../../../lib/checkMode";

export const validate = (values) => {
  const errors = {};

  if (!values.from) {
    errors.value = 'Please select a user';
  }

  if (!values.fromAddress) {
    errors.value = 'Please select a address';
  }

  if (isOauthEnabled() && !values.address) {
    errors.value = "Please enter address"
  }

  if (!isOauthEnabled()) {

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
