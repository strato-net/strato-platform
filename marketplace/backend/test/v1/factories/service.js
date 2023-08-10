export const serviceArgs = (uid) => {
  const args = {
    name: `name_${uid}`,
    description: `description_${uid}`,
    price: uid,
    createdDate: uid,
  }

  return args
}