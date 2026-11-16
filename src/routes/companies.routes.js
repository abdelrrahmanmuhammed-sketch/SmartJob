const express = require('express');
const prisma = require('../db');
const { optionalAuthenticate } = require('../middleware/auth.middleware');

const router = express.Router();

// GET /api/companies
router.get('/', optionalAuthenticate, async (req, res, next) => {
  try {
    const { location, industry, search, page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const take = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * take;

    const where = {
      user: { status: 'ACTIVE' }
    };

    if (location) {
      where.location = { contains: location.trim() };
    }
    if (industry) {
      where.industry = { contains: industry.trim() };
    }
    if (search) {
      where.companyName = { contains: search.trim() };
    }

    const [companies, totalCount] = await Promise.all([
      prisma.companyProfile.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { jobs: { where: { status: 'ACTIVE' } } }
          }
        }
      }),
      prisma.companyProfile.count({ where })
    ]);

    res.json({
      success: true,
      data: companies.map(c => ({
        id: c.id,
        userId: c.userId,
        companyName: c.companyName,
        industry: c.industry,
        location: c.location,
        address: c.address,
        description: c.description,
        publicContactPhone: c.publicContactPhone,
        activeJobsCount: c._count.jobs,
        createdAt: c.createdAt
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

// GET /api/companies/:id
router.get('/:id', optionalAuthenticate, async (req, res, next) => {
  try {
    const company = await prisma.companyProfile.findUnique({
      where: { id: req.params.id },
      include: {
        jobs: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!company) {
      return res.status(404).json({ success: false, message: 'الشركة غير موجودة' });
    }

    res.json({
      success: true,
      company: {
        id: company.id,
        userId: company.userId,
        companyName: company.companyName,
        industry: company.industry,
        location: company.location,
        address: company.address,
        description: company.description,
        publicContactPhone: company.publicContactPhone,
        jobs: company.jobs,
        createdAt: company.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
