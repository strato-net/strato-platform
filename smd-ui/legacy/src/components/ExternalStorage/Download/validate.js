export default function validate(values) {
  const errors = {};

  if (!values.contractAddress) {
    errors.contractAddress = "Can't be blank";
  }

  return errors;
}