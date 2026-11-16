function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'يجب تسجيل الدخول للوصول إلى هذا المورد'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح: ليس لديك الصلاحية الكافية للوصول إلى هذه الصفحة أو الإجراء'
      });
    }

    next();
  };
}

module.exports = {
  requireRole,
  requireAdmin: requireRole('ADMIN'),
  requireCompany: requireRole('COMPANY'),
  requireWorker: requireRole('WORKER')
};
