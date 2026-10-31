import mongoSanitizePackage from "express-mongo-sanitize";

// express-mongo-sanitize's own middleware assigns to req.query, which is a
// getter-only property in Express 5. Its exported sanitize() helper mutates
// the supplied object in place, so this wrapper is Express 5 compatible.
const sanitize = mongoSanitizePackage.sanitize;

export function mongoSanitize(req, _res, next) {
  for (const part of ["body", "params"]) {
    const value = req[part];
    if (value && typeof value === "object") {
      sanitize(value);
    }
  }

  // Express 5 defines req.query as a getter that reparses the URL on every
  // access. Mutating that object alone would be discarded, and assigning to
  // req.query throws. Define an own property so the sanitized object (and
  // later middleware such as hpp) works with a stable query object.
  if (req.query && typeof req.query === "object") {
    const query = sanitize(req.query);
    Object.defineProperty(req, "query", {
      value: query,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  return next();
}
