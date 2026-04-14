import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    role: string;
  };
}

export const verifyToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET as string
    ) as any;

    const decodedRole = String(decoded?.role || "customer");
    const decodedId = Number(decoded?.id ?? decoded?.user_id);
    const isAdminToken = decodedRole === "admin";

    if (
      !Number.isInteger(decodedId) ||
      (!isAdminToken && decodedId <= 0) ||
      (isAdminToken && decodedId < 0)
    ) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    req.user = {
      id: decodedId,
      role: decodedRole,
    };

    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
