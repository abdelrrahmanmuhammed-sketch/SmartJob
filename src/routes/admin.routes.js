const express = require('express');
const prisma = require('../db');
const { authenticate } = require('../middleware/auth.middleware');
const { requireAdmin } = require('../middleware/rbac.middleware');

const router = express.Router();

// Enforce server-side Admin role on all /api/admin/* routes
router.use(authenticate, requireAdmin);

// GET /api/admin/overview
router.get('/overview', async (req, res, next) => {
  try {
    const [
      totalWorkers,
      totalCompanies,
      totalJobs,
      totalApplications,
      totalAdRequests,
      recentWorkers,
      recentCompanies,
      recentApplications
    ] = await Promise.all([
      prisma.workerProfile.count(),
      prisma.companyProfile.count(),
      prisma.job.count({ where: { status: 'ACTIVE' } }),
      prisma.application.count(),
      prisma.publicAdRequest.count(),
      prisma.workerProfile.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { phone: true, status: true, createdAt: true } } }
      }),
      prisma.companyProfile.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { phone: true, status: true, createdAt: true } } }
      }),
      prisma.application.findMany({
        take: 5,
        orderBy: { submittedAt: 'desc' },
        include: {
          job: { select: { title: true } },
          worker: { select: { fullName: true } }
        }
      })
    ]);

    // Live authoritative metrics calculated directly from database records without any demo-padding
    res.json({
      success: true,
      metrics: {
        totalWorkers,
        totalCompanies,
        totalJobs,
        totalApplications,
        totalAdRequests
      },
      recent: {
        workers: recentWorkers.map(w => ({
          id: w.id,
          userId: w.userId,
          fullName: w.fullName,
          profession: w.profession,
          location: w.location,
          phone: w.user.phone,
          status: w.user.status,
          createdAt: w.user.createdAt
        })),
        companies: recentCompanies.map(c => ({
          id: c.id,
          userId: c.userId,
          companyName: c.companyName,
          location: c.location,
          industry: c.industry,
          phone: c.user.phone,
          status: c.user.status,
          createdAt: c.user.createdAt
        })),
        applications: recentApplications.map(a => ({
          id: a.id,
          jobTitle: a.job.title,
          workerName: a.worker.fullName,
          status: a.status,
          submittedAt: a.submittedAt
        }))
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/registrations
router.get('/registrations', async (req, res, next) => {
  try {
    const { role = 'ALL', status } = req.query;

    const where = {};
    if (role !== 'ALL') {
      where.role = role;
    } else {
      where.role = { in: ['WORKER', 'COMPANY'] };
    }
    if (status) {
      where.status = status;
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        workerProfile: true,
        companyProfile: true
      }
    });

    res.json({
      success: true,
      data: users.map(u => ({
        id: u.id,
        phone: u.phone,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        details: u.role === 'WORKER' ? u.workerProfile : u.companyProfile
      }))
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/users/:id/status
router.patch('/users/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['ACTIVE', 'PENDING', 'SUSPENDED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'حالة الحساب غير صالحة' });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: req.params.id }
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (targetUser.role === 'ADMIN') {
      return res.status(403).json({ success: false, message: 'لا يمكن تعديل حالة حساب المسؤول الرئيسي' });
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { status }
    });

    // Record in Audit Log
    try {
      await prisma.auditLog.create({
        data: {
          actorId: req.user.id,
          action: 'MODERATE_USER_STATUS',
          targetType: 'User',
          targetId: updated.id,
          metadata: JSON.stringify({ oldStatus: targetUser.status, newStatus: status })
        }
      });
    } catch (_) {}

    res.json({
      success: true,
      message: 'تم تحديث حالة الحساب بنجاح',
      user: {
        id: updated.id,
        phone: updated.phone,
        role: updated.role,
        status: updated.status
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/audit-logs
router.get('/audit-logs', async (req, res, next) => {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: 100,
      include: {
        actor: { select: { id: true, phone: true, role: true } }
      }
    });

    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
