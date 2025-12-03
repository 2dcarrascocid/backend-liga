export const composeMiddlewares = (...funcs) => {
  return funcs.reduceRight(
    (next, fn) => fn(next),
    async () => ({})
  );
};
