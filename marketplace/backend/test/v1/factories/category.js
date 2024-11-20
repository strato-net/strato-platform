export const categoryArgs = (uid) => {
  const args = {
    name: `name_${uid}`,
    description: `description_${uid}`,
    imageKey: `1675078111777_seeds.jpg`,
  };

  return args;
};

export const updateCategoryArgs = (address, uid) => {
  const args = {
    address,
    updates: {
      name: `name_${uid}`,
      description: `description_${uid}`,
      imageKey: `1675078111777_seeds.jpg`,
    },
  };

  return args;
};
