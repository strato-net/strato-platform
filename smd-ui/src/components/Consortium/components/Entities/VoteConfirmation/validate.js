export function validate(values) {
    const errors = {};
  
    if (!values.entity) {
      errors.entity = "Please enter your entity name";
    }
    if (!values.password) {
      errors.password = "Please enter your password";
    }

    return errors;
  }