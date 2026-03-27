import jwt from "jsonwebtoken";
import type { RoleName } from "@prisma/client";

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: RoleName;
  departmentId: string;
  authVersion: number;
};

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET must be set (min 16 characters)");
  }
  return secret;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const expiresIn = (process.env.JWT_EXPIRES_IN ?? "7d") as jwt.SignOptions["expiresIn"];
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
  const decoded = jwt.verify(token, getSecret()) as jwt.JwtPayload & {
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
  if (
    !sub ||
    !email ||
    !role ||
    !departmentId ||
    authVersion === undefined ||
    authVersion === null ||
    typeof authVersion !== "number"
  ) {
    throw new Error("Invalid token payload");
  }
  return { sub, email, role, departmentId, authVersion };
}
