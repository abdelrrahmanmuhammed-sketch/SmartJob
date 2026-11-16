const express = require('express');
const prisma = require('../db');
const config = require('../config');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

// GET /api/me
router.get('/', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        workerProfile: {
          include: {
            certificates: true
          }
        },
        companyProfile: true
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        profile: user.role === 'WORKER' ? user.workerProfile : (user.role === 'COMPANY' ? user.companyProfile : null)
      }
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/me/profile
router.patch('/profile', authenticate, async (req, res, next) => {
  try {
    const { role, id } = req.user;

    if (role === 'WORKER') {
      const { fullName, location, profession, otherProfessions, experienceYears, bio, skills, expectedPay } = req.body;

      const updated = await prisma.workerProfile.update({
        where: { userId: id },
        data: {
          fullName: fullName !== undefined ? fullName.trim() : undefined,
          location: location !== undefined ? location.trim() : undefined,
          profession: profession !== undefined ? profession.trim() : undefined,
          otherProfessions: otherProfessions !== undefined ? otherProfessions : undefined,
          experienceYears: experienceYears !== undefined ? (parseInt(experienceYears, 10) || 0) : undefined,
          experience: experienceYears !== undefined ? `${parseInt(experienceYears, 10) || 0} سنوات` : undefined,
          bio: bio !== undefined ? bio.trim() : undefined,
          skills: skills !== undefined ? skills.trim() : undefined,
          expectedPay: expectedPay !== undefined ? expectedPay.trim() : undefined
        }
      });

      return res.json({
        success: true,
        message: 'تم تحديث الملف الشخصي للعامل بنجاح',
        profile: updated
      });
    } else if (role === 'COMPANY') {
      const { companyName, location, industry, address, description, publicContactPhone } = req.body;

      const updated = await prisma.companyProfile.update({
        where: { userId: id },
        data: {
          companyName: companyName !== undefined ? companyName.trim() : undefined,
          location: location !== undefined ? location.trim() : undefined,
          industry: industry !== undefined ? industry.trim() : undefined,
          address: address !== undefined ? address.trim() : undefined,
          description: description !== undefined ? description.trim() : undefined,
          publicContactPhone: publicContactPhone !== undefined ? publicContactPhone.trim() : undefined
        }
      });

      return res.json({
        success: true,
        message: 'تم تحديث بيانات الشركة بنجاح',
        profile: updated
      });
    }

    res.json({ success: true, message: 'تم حفظ البيانات' });
  } catch (error) {
    next(error);
  }
});

// POST /api/me/change-phone (Transactional phone number update preserving stable UUID relationships)
router.post('/change-phone', authenticate, async (req, res, next) => {
  try {
    const { newPhone } = req.body;
    if (!newPhone) {
      return res.status(400).json({ success: false, message: 'يرجى تقديم رقم الهاتف الجديد' });
    }

    const normPhone = config.normalizePhone(newPhone);
    if (normPhone === config.adminNormalizedPhone && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'لا يمكن تعيين رقم الإدارة لحساب مستخدم' });
    }

    const existing = await prisma.user.findUnique({
      where: { phone: normPhone }
    });

    if (existing && existing.id !== req.user.id) {
      return res.status(409).json({ success: false, message: 'رقم الهاتف الجديد مستخدم بالفعل لحساب آخر' });
    }

    // Database transaction updates identity while preserving foreign key UUID relationships
    const updatedUser = await prisma.$transaction(async (tx) => {
      return await tx.user.update({
        where: { id: req.user.id },
        data: { phone: normPhone }
      });
    });

    res.json({
      success: true,
      message: 'تم تحديث رقم الهاتف بنجاح، وجميع السجلات والوظائف والرسائل المرتبطة محفوظة ومستمرة.',
      phone: updatedUser.phone
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
