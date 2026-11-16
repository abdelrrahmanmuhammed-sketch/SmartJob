const express = require('express');
const prisma = require('../db');
const config = require('../config');
const { notifyAdmins } = require('../services/notification.service');

const router = express.Router();

// GET /api/public/config
// Returns public platform settings including public contact number
router.get('/config', (req, res) => {
  res.json({
    success: true,
    publicAdContactNumber: config.publicAdContactNumber, // Strictly 01154093079
    platformName: 'Smart Job Platform'
  });
});

// POST /api/public/ad-requests
// Submit advertising or public communication request
router.post('/ad-requests', async (req, res, next) => {
  try {
    const { companyName, phone, title, body } = req.body;

    if (!companyName || !phone || !title) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إدخال اسم الشركة ورقم الهاتف وعنوان طلب الإعلان'
      });
    }

    const adRequest = await prisma.publicAdRequest.create({
      data: {
        companyName: companyName.trim(),
        phone: phone.trim(),
        title: title.trim(),
        body: body ? body.trim() : ''
      }
    });

    // Notify Admin about new ad request
    try {
      await notifyAdmins({
        eventType: 'AD_REQUEST_CREATED',
        title: 'طلب إعلان جديد على المنصة',
        message: `وصل طلب إعلان جديد من "${companyName.trim()}" (هاتف: ${phone.trim()}).`,
        relatedRecordId: adRequest.id
      });
    } catch (_) {}

    res.status(201).json({
      success: true,
      message: 'تم إرسال طلب الإعلان للإدارة بنجاح',
      adRequest
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/public/ad-requests (Internal / Admin retrieval)
router.get('/ad-requests', async (req, res, next) => {
  try {
    const requests = await prisma.publicAdRequest.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json({
      success: true,
      data: requests
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
