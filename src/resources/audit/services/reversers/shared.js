export const OMIT_FIELDS = ['_id', '__v', 'createdAt', 'updatedAt'];

export const restoreFields = (before) => Object.fromEntries(
  Object.entries(before).filter(([k]) => !OMIT_FIELDS.includes(k)),
);
