const jwt = require('jsonwebtoken');
const config = require('../config');
const prisma = require('../db');

async function authenticate(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'غير مصرح: يرجى تسجيل الدخول أولاً'
      });
    }

    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        workerProfile: true,
        companyProfile: true
      }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'الحساب غير موجود أو تم حذفه'
      });
    }

    if (user.status === 'SUSPENDED' || user.status === 'REJECTED') {
      return res.status(403).json({
        success: false,
        message: 'الحساب معلق أو محظور من قبل الإدارة'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً'
      });
    }
    return res.status(401).json({
      success: false,
      message: 'رمز التحقق غير صالح'
    });
  }
}

function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }
  return authenticate(req, res, next);
}

module.exports = {
  authenticate,
  optionalAuthenticate
};
