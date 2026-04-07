export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72;
export const PASSWORD_RE =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d]).{10,}$/;
export const PASSWORD_RULE =
  `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters and include uppercase, lowercase, a digit, and a special character`;
