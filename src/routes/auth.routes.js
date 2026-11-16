const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../db');
const config = require('../config');
const { notifyAdmins } = require('../services/notification.service');

const router = express.Router();

function generateToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role, phone: user.phone },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

// POST /api/auth/register/worker
router.post('/register/worker', async (req, res, next) => {
  try {
    const { phone, password, fullName, location, profession, otherProfessions, experienceYears, bio, skills } = req.body;

    if (!phone || !password || !fullName || !profession || !location) {
      return res.status(400).json({
        success: false,
        message: 'جميع الحقول الأساسية مطلوبة (رقم الهاتف، كلمة المرور، الاسم الكامل، المهنة، المحافظة)'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'كلمة المرور يجب ألا تقل عن 6 أحرف أو أرقام'
      });
    }

    const normPhone = config.normalizePhone(phone);

    // Prevent public registration with the Admin phone number
    if (normPhone === config.adminNormalizedPhone) {
      return res.status(403).json({
        success: false,
        message: 'رقم الهاتف هذا مخصص للإدارة ولا يمكن التسجيل به كعامل'
      });
    }

    // Check duplicate
    const existing = await prisma.user.findUnique({
      where: { phone: normPhone }
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'رقم الهاتف هذا مسجل بالفعل مسبقاً، يرجى تسجيل الدخول'
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const expYears = parseInt(experienceYears, 10) || 0;

    // Transactional creation
    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone: normPhone,
          passwordHash,
          role: 'WORKER',
          status: 'ACTIVE',
          workerProfile: {
            create: {
              fullName: fullName.trim(),
              location: location.trim(),
              profession: profession.trim(),
              otherProfessions: otherProfessions ? otherProfessions.trim() : null,
              experienceYears: expYears,
              experience: expYears > 0 ? `${expYears} سنوات` : 'مبتدئ',
              bio: bio ? bio.trim() : '',
              skills: skills ? skills.trim() : profession.trim()
            }
          }
        },
        include: {
          workerProfile: true
        }
      });
      return user;
    });

    // Generate persistent notification for Admin & deliver in real-time
    try {
      await notifyAdmins({
        eventType: 'WORKER_REGISTERED',
        title: 'تسجيل عامل جديد',
        message: `سجل العامل الجديد "${fullName.trim()}" (${profession.trim()} - ${location.trim()}) على المنصة بنجاح.`,
        relatedRecordId: newUser.id,
        metadata: {
          workerId: newUser.workerProfile.id,
          phone: normPhone,
          registeredAt: new Date().toISOString()
        }
      });
    } catch (notifErr) {
      console.error('[ADMIN_ALERT_ERROR]', notifErr.message);
    }

    const token = generateToken(newUser);

    res.status(201).json({
      success: true,
      message: 'تم تسجيل حساب العامل بنجاح',
      token,
      user: {
        id: newUser.id,
        phone: newUser.phone,
        role: newUser.role,
        profile: newUser.workerProfile
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/register/company
router.post('/register/company', async (req, res, next) => {
  try {
    const { phone, password, companyName, location, industry, address, description, publicContactPhone } = req.body;

    if (!phone || !password || !companyName || !location) {
      return res.status(400).json({
        success: false,
        message: 'جميع الحقول الأساسية مطلوبة (رقم الهاتف، كلمة المرور، اسم الشركة، المحافظة)'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'كلمة المرور يجب ألا تقل عن 6 أحرف أو أرقام'
      });
    }

    const normPhone = config.normalizePhone(phone);

    if (normPhone === config.adminNormalizedPhone) {
      return res.status(403).json({
        success: false,
        message: 'رقم الهاتف هذا مخصص للإدارة ولا يمكن التسجيل به كشركة'
      });
    }

    const existing = await prisma.user.findUnique({
      where: { phone: normPhone }
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'رقم الهاتف هذا مسجل بالفعل مسبقاً، يرجى تسجيل الدخول'
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone: normPhone,
          passwordHash,
          role: 'COMPANY',
          status: 'ACTIVE',
          companyProfile: {
            create: {
              companyName: companyName.trim(),
              location: location.trim(),
              industry: industry ? industry.trim() : 'خدمات وصيانة',
              address: address ? address.trim() : location.trim(),
              description: description ? description.trim() : '',
              publicContactPhone: publicContactPhone ? publicContactPhone.trim() : normPhone
            }
          }
        },
        include: {
          companyProfile: true
        }
      });
      return user;
    });

    const token = generateToken(newUser);

    res.status(201).json({
      success: true,
      message: 'تم تسجيل حساب الشركة بنجاح',
      token,
      user: {
        id: newUser.id,
        phone: newUser.phone,
        role: newUser.role,
        profile: newUser.companyProfile
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إدخال رقم الهاتف وكلمة المرور'
      });
    }

    const normPhone = config.normalizePhone(phone);

    const user = await prisma.user.findUnique({
      where: { phone: normPhone },
      include: {
        workerProfile: true,
        companyProfile: true
      }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'بيانات الدخول غير صحيحة، يرجى التحقق من رقم الهاتف وكلمة المرور'
      });
    }

    if (user.status === 'SUSPENDED' || user.status === 'REJECTED') {
      return res.status(403).json({
        success: false,
        message: 'هذا الحساب معلق من قبل الإدارة'
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'بيانات الدخول غير صحيحة، يرجى التحقق من رقم الهاتف وكلمة المرور'
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    const token = generateToken(user);

    res.json({
      success: true,
      message: 'تم تسجيل الدخول بنجاح',
      token,
      user: {
        id: user.id,
        phone: user.phone,
        role: user.role,
        profile: user.role === 'WORKER' ? user.workerProfile : (user.role === 'COMPANY' ? user.companyProfile : null)
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({
    success: true,
    message: 'تم تسجيل الخروج بنجاح'
  });
});

module.exports = router;
