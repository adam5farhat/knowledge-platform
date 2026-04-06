export const PASSWORD_MIN = 10;
export const PASSWORD_RE =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d]).{10,}$/;
export const PASSWORD_RULE =
  `Password must be at least ${PASSWORD_MIN} characters and include uppercase, lowercase, a digit, and a special character`;
