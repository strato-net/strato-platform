export const subCategoryArgs = (categoryAddress, uid) => {
  const args = {
    categoryAddress,
    name: `name_${uid}`,
    description: `description_${uid}`,
  };

  return args;
};

export const updateSubCategoryArgs = (
  categoryAddress,
  subCategoryAddress,
  uid
) => {
  const args = {
    categoryAddress,
    subCategoryAddress,
    updates: {
      name: `name_${uid}`,
      description: `description_${uid}`,
    },
  };

  return args;
};
