const express = require('express');
const prisma = require('../db');
const { authenticate } = require('../middleware/auth.middleware');
const { requireWorker, requireCompany } = require('../middleware/rbac.middleware');
const { createNotification } = require('../services/notification.service');

const router = express.Router();

// POST /api/jobs/:id/applications
router.post('/jobs/:id/applications', authenticate, requireWorker, async (req, res, next) => {
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

// GET /api/applications
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { role, id } = req.user;

    let applications = [];

    if (role === 'WORKER') {
      const worker = await prisma.workerProfile.findUnique({
        where: { userId: id }
      });
      if (worker) {
        applications = await prisma.application.findMany({
          where: { workerId: worker.id },
          orderBy: { submittedAt: 'desc' },
          include: {
            job: {
              include: {
                company: true
              }
            }
          }
        });
      }
    } else if (role === 'COMPANY') {
      const company = await prisma.companyProfile.findUnique({
        where: { userId: id }
      });
      if (company) {
        applications = await prisma.application.findMany({
          where: {
            job: { companyId: company.id }
          },
          orderBy: { submittedAt: 'desc' },
          include: {
            job: true,
            worker: {
              include: {
                user: { select: { phone: true } },
                certificates: true
              }
            }
          }
        });
      }
    } else if (role === 'ADMIN') {
      applications = await prisma.application.findMany({
        orderBy: { submittedAt: 'desc' },
        take: 100,
        include: {
          job: { include: { company: true } },
          worker: { include: { user: { select: { phone: true } } } }
        }
      });
    }

    res.json({
      success: true,
      data: applications
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/applications/:id/status
router.patch('/:id/status', authenticate, requireCompany, async (req, res, next) => {
  try {
    const { status, employerNotes } = req.body;

    if (!['UNDER_REVIEW', 'ACCEPTED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'حالة الطلب غير صالحة' });
    }

    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: {
        job: { include: { company: true } },
        worker: true
      }
    });

    if (!application) {
      return res.status(404).json({ success: false, message: 'طلب التوظيف غير موجود' });
    }

    if (application.job.company.userId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'غير مصرح بتعديل هذا الطلب' });
    }

    const updated = await prisma.application.update({
      where: { id: req.params.id },
      data: {
        status,
        employerNotes: employerNotes !== undefined ? employerNotes : application.employerNotes
      }
    });

    // Notify worker about decision
    try {
      const statusLabel = status === 'ACCEPTED' ? 'تم قبول طلبك' : (status === 'REJECTED' ? 'تم رفض طلبك' : 'قيد المراجعة');
      await createNotification({
        recipientId: application.worker.userId,
        eventType: 'APPLICATION_STATUS_CHANGED',
        title: `تحديث في طلب التوظيف: ${application.job.title}`,
        message: `قامت شركة "${application.job.company.companyName}" بتحديث حالة طلبك إلى (${statusLabel}).`,
        relatedRecordId: application.id
      });
    } catch (notifErr) {
      console.error('[NOTIFY_WORKER_ERROR]', notifErr.message);
    }

    res.json({
      success: true,
      message: 'تم تحديث حالة طلب التوظيف بنجاح',
      application: updated
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
