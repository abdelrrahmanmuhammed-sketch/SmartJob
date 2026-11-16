const express = require('express');
const prisma = require('../db');
const { optionalAuthenticate, authenticate } = require('../middleware/auth.middleware');
const { requireCompany, requireWorker } = require('../middleware/rbac.middleware');
const { createNotification } = require('../services/notification.service');

const router = express.Router();

// GET /api/jobs
router.get('/', optionalAuthenticate, async (req, res, next) => {
  try {
    const { profession, location, search, minExp, page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const take = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * take;

    const where = {
      status: 'ACTIVE'
    };

    if (profession) {
      where.profession = { contains: profession.trim() };
    }
    if (location) {
      where.location = { contains: location.trim() };
    }
    if (minExp) {
      where.experienceYearsMin = { lte: parseInt(minExp, 10) || 0 };
    }
    if (search) {
      where.OR = [
        { title: { contains: search.trim() } },
        { description: { contains: search.trim() } },
        { profession: { contains: search.trim() } }
      ];
    }

    const [jobs, totalCount] = await Promise.all([
      prisma.job.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          company: {
            select: {
              id: true,
              companyName: true,
              location: true,
              publicContactPhone: true
            }
          }
        }
      }),
      prisma.job.count({ where })
    ]);

    res.json({
      success: true,
      data: jobs.map(j => ({
        id: j.id,
        title: j.title,
        profession: j.profession,
        companyName: j.company.companyName,
        companyId: j.company.id,
        location: j.location,
        salary: j.salary || 'حسب الاتفاق',
        salaryRange: j.salaryRange,
        experienceLevel: j.experienceLevel,
        experienceYearsMin: j.experienceYearsMin,
        contactPhone: j.contactPhone || j.company.publicContactPhone,
        description: j.description,
        status: j.status,
        createdAt: j.createdAt
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

// GET /api/jobs/:id
router.get('/:id', optionalAuthenticate, async (req, res, next) => {
  try {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: {
        company: true
      }
    });

    if (!job) {
      return res.status(404).json({ success: false, message: 'فرصة العمل غير موجودة' });
    }

    res.json({
      success: true,
      job: {
        id: job.id,
        title: job.title,
        profession: job.profession,
        companyName: job.company.companyName,
        companyId: job.company.id,
        location: job.location,
        salary: job.salary,
        experienceLevel: job.experienceLevel,
        experienceYearsMin: job.experienceYearsMin,
        contactPhone: job.contactPhone || job.company.publicContactPhone,
        description: job.description,
        skills: job.skills,
        status: job.status,
        createdAt: job.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/jobs
router.post('/', authenticate, requireCompany, async (req, res, next) => {
  try {
    const { title, profession, description, experienceLevel, experienceYearsMin, location, salary, contactPhone } = req.body;

    if (!title || !profession || !experienceLevel) {
      return res.status(400).json({
        success: false,
        message: 'الحقول الأساسية مطلوبة (عنوان الوظيفة، المهنة، مستوى الخبرة)'
      });
    }

    const companyProfile = await prisma.companyProfile.findUnique({
      where: { userId: req.user.id }
    });

    if (!companyProfile) {
      return res.status(404).json({ success: false, message: 'ملف الشركة غير موجود' });
    }

    const expMin = parseInt(experienceYearsMin, 10) || 0;

    const newJob = await prisma.job.create({
      data: {
        companyId: companyProfile.id,
        title: title.trim(),
        profession: profession.trim(),
        description: description ? description.trim() : title.trim(),
        experienceLevel: experienceLevel.trim(),
        experienceYearsMin: expMin,
        location: location ? location.trim() : companyProfile.location,
        salary: salary ? salary.trim() : 'حسب الاتفاق',
        contactPhone: contactPhone ? contactPhone.trim() : (companyProfile.publicContactPhone || req.user.phone),
        status: 'ACTIVE'
      },
      include: {
        company: true
      }
    });

    res.status(201).json({
      success: true,
      message: 'تم نشر فرصة العمل بنجاح في قاعدة البيانات',
      job: newJob
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/jobs/:id
router.patch('/:id', authenticate, requireCompany, async (req, res, next) => {
  try {
    const company = await prisma.companyProfile.findUnique({
      where: { userId: req.user.id }
    });

    const job = await prisma.job.findUnique({
      where: { id: req.params.id }
    });

    if (!job) {
      return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });
    }

    if (job.companyId !== company.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'غير مصرح بتعديل وظيفة تابعة لشركة أخرى' });
    }

    const { title, profession, description, experienceLevel, experienceYearsMin, location, salary, status } = req.body;

    const updated = await prisma.job.update({
      where: { id: req.params.id },
      data: {
        title: title !== undefined ? title.trim() : undefined,
        profession: profession !== undefined ? profession.trim() : undefined,
        description: description !== undefined ? description.trim() : undefined,
        experienceLevel: experienceLevel !== undefined ? experienceLevel.trim() : undefined,
        experienceYearsMin: experienceYearsMin !== undefined ? (parseInt(experienceYearsMin, 10) || 0) : undefined,
        location: location !== undefined ? location.trim() : undefined,
        salary: salary !== undefined ? salary.trim() : undefined,
        status: status !== undefined ? status : undefined
      }
    });

    res.json({
      success: true,
      message: 'تم تحديث الوظيفة بنجاح',
      job: updated
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/jobs/:id
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { company: true }
    });

    if (!job) {
      return res.status(404).json({ success: false, message: 'الوظيفة غير موجودة' });
    }

    if (req.user.role !== 'ADMIN') {
      const company = await prisma.companyProfile.findUnique({
        where: { userId: req.user.id }
      });
      if (!company || job.companyId !== company.id) {
        return res.status(403).json({ success: false, message: 'غير مصرح بحذف هذه الوظيفة' });
      }
    }

    await prisma.job.delete({
      where: { id: req.params.id }
    });

    res.json({
      success: true,
      message: 'تم حذف الوظيفة بنجاح'
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/jobs/:id/applications
router.post('/:id/applications', authenticate, requireWorker, async (req, res, next) => {
  try {
    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.id }
    });

    if (!workerProfile) {
      return res.status(404).json({ success: false, message: 'ملف العامل غير موجود' });
    }

    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { company: true }
    });

    if (!job || job.status !== 'ACTIVE') {
      return res.status(404).json({ success: false, message: 'فرصة العمل غير متوفرة أو مغلقة' });
    }

    // Check if worker already applied
    const existing = await prisma.application.findUnique({
      where: {
        workerId_jobId: {
          workerId: workerProfile.id,
          jobId: job.id
        }
      }
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'لقد قمت بالتقديم على هذه الوظيفة مسبقاً'
      });
    }

    const application = await prisma.application.create({
      data: {
        workerId: workerProfile.id,
        jobId: job.id,
        status: 'UNDER_REVIEW'
      },
      include: {
        job: true
      }
    });

    // Notify company
    try {
      await createNotification({
        recipientId: job.company.userId,
        eventType: 'APPLICATION_SUBMITTED',
        title: 'طلب توظيف جديد',
        message: `تقدّم العامل "${workerProfile.fullName}" على وظيفة "${job.title}".`,
        relatedRecordId: application.id,
        metadata: {
          jobId: job.id,
          workerId: workerProfile.id,
          workerName: workerProfile.fullName,
          workerProfession: workerProfile.profession
        }
      });
    } catch (notifErr) {
      console.error('[NOTIFY_COMPANY_ERROR]', notifErr.message);
    }

    res.status(201).json({
      success: true,
      message: 'تم إرسال طلب التوظيف بنجاح للشركة',
      application
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
