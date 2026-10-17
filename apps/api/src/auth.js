import jwt from "jsonwebtoken";
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    if (!claims.sub || !claims.tenantId || !claims.role)
      return res.status(401).json({ error: "INVALID_TOKEN" });
    req.user = { id: claims.sub, tenantId: claims.tenantId, role: claims.role };
    next();
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
}
export function requireRevenueRole(req, res, next) {
  if (!["tenant_admin", "revenue_manager"].includes(req.user?.role))
    return res.status(403).json({ error: "FORBIDDEN" });
  next();
}
