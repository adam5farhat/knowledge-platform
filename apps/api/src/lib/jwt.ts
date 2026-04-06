import jwt from "jsonwebtoken";
import { RoleName } from "@prisma/client";
import { config } from "./config.js";

/**
 * Access tokens carry signed claims for `sub`, `authVersion`, `email`, `role`, and primary
 * `departmentId`. Authorization must **not** trust those claims alone: `authenticateToken`
 * loads the user from the DB and rejects the token with `ACCESS_TOKEN_OUTDATED` if any of
 * email / role / primary department disagree (forcing refresh). `authVersion` invalidation
 * covers broader account changes; department-scoped rights (`UserDepartmentAccess`) are
 * resolved from the DB on every request and are not embedded in the JWT.
 */
export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: RoleName;
  departmentId: string;
  authVersion: number;
};

function getSecret(): string {
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be set (min 32 characters)");
  }
  return config.jwtSecret;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const expiresIn = config.jwtExpiresIn as jwt.SignOptions["expiresIn"];
  const options: jwt.SignOptions = {
    expiresIn,
    subject: payload.sub,
  };
  return jwt.sign(
    {
      email: payload.email,
      role: payload.role,
      departmentId: payload.departmentId,
      authVersion: payload.authVersion,
    },
    getSecret(),
    options,
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, getSecret(), { algorithms: ["HS256"] }) as jwt.JwtPayload & {
    email?: string;
    role?: RoleName;
    departmentId?: string;
    authVersion?: number;
  };
  const sub = decoded.sub;
  const email = decoded.email;
  const role = decoded.role;
  const departmentId = decoded.departmentId;
  const authVersion = decoded.authVersion;
  const validRoles = new Set<string>(Object.values(RoleName));
  if (
    !sub ||
    !email ||
    !role ||
    !validRoles.has(role) ||
    !departmentId ||
    authVersion === undefined ||
    authVersion === null ||
    typeof authVersion !== "number"
  ) {
    throw new Error("Invalid token payload");
  }
  return { sub, email, role, departmentId, authVersion };
}
