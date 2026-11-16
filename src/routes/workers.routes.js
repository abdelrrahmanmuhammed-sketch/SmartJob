const express = require('express');
const prisma = require('../db');
const { optionalAuthenticate, authenticate } = require('../middleware/auth.middleware');
const { requireWorker } = require('../middleware/rbac.middleware');
const { normalizeArabic } = require('../utils/arabic.utils');

const router = express.Router();

// GET /api/workers
router.get('/', optionalAuthenticate, async (req, res, next) => {
  try {
    const { profession, location, minExp, search, page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const take = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * take;

    const where = {
      user: { status: 'ACTIVE' }
    };

    if (location) {
      where.location = { contains: location.trim() };
    }

    if (minExp) {
      where.experienceYears = { gte: parseInt(minExp, 10) || 0 };
    }

    if (profession) {
      where.profession = { contains: profession.trim() };
    }

    const [workers, totalCount] = await Promise.all([
      prisma.workerProfile.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, phone: true, createdAt: true }
          },
          certificates: true
        }
      }),
      prisma.workerProfile.count({ where })
    ]);

    res.json({
      success: true,
      data: workers.map(w => ({
        id: w.id,
        userId: w.userId,
        fullName: w.fullName,
        profession: w.profession,
        otherProfessions: w.otherProfessions,
        location: w.location,
        experienceYears: w.experienceYears,
        experience: w.experience,
        skills: w.skills,
        bio: w.bio,
        assessmentScore: w.assessmentScore,
        phone: w.user.phone,
        certificatesCount: w.certificates.length,
        createdAt: w.createdAt
      })),
      pagination: {
        page: pageNum,
        limit: take,
        total: totalCount,
        totalPages: Math.ceil(totalCount / take)
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/workers/:id
router.get('/:id', optionalAuthenticate, async (req, res, next) => {
  try {
    const worker = await prisma.workerProfile.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, phone: true, createdAt: true } },
        certificates: true
      }
    });

    if (!worker) {
      return res.status(404).json({ success: false, message: 'العامل غير موجود' });
    }

    res.json({
      success: true,
      worker: {
        id: worker.id,
        userId: worker.userId,
        fullName: worker.fullName,
        profession: worker.profession,
        otherProfessions: worker.otherProfessions,
        location: worker.location,
        experienceYears: worker.experienceYears,
        experience: worker.experience,
        skills: worker.skills,
        bio: worker.bio,
        expectedPay: worker.expectedPay,
        assessmentScore: worker.assessmentScore,
        phone: worker.user.phone,
        certificates: worker.certificates,
        createdAt: worker.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/workers/assessment (Save assessed score)
router.post('/assessment', authenticate, requireWorker, async (req, res, next) => {
  try {
    const { score } = req.body;
    const finalScore = Math.min(100, Math.max(0, parseInt(score, 10) || 0));

    const updated = await prisma.workerProfile.update({
      where: { userId: req.user.id },
      data: { assessmentScore: finalScore }
    });

    res.json({
      success: true,
      message: 'تم حفظ نتيجة تقييم المهارات بنجاح في قاعدة البيانات',
      assessmentScore: updated.assessmentScore
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
