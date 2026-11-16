const express = require('express');
const prisma = require('../db');
const { authenticate } = require('../middleware/auth.middleware');
const { addClient } = require('../services/notification.service');

const router = express.Router();

// GET /api/notifications/stream (Server-Sent Events Realtime Notification Stream)
router.get('/stream', authenticate, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  res.write(': connected\n\n');

  // Register client for instant push
  addClient(req.user.id, res);

  // Send initial unread count
  prisma.notification.count({
    where: { recipientId: req.user.id, readAt: null }
  }).then(count => {
    res.write(`event: unread-count\ndata: ${JSON.stringify({ unreadCount: count })}\n\n`);
  }).catch(() => {});
});

// GET /api/notifications (Persisted History)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { recipientId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    const unreadCount = await prisma.notification.count({
      where: { recipientId: req.user.id, readAt: null }
    });

    res.json({
      success: true,
      unreadCount,
      data: notifications
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', authenticate, async (req, res, next) => {
  try {
    const notif = await prisma.notification.findUnique({
      where: { id: req.params.id }
    });

    if (!notif || notif.recipientId !== req.user.id) {
      return res.status(404).json({ success: false, message: 'الإشعار غير موجود' });
    }

    const updated = await prisma.notification.update({
      where: { id: req.params.id },
      data: { readAt: new Date() }
    });

    res.json({
      success: true,
      message: 'تم تعيين الإشعار كمقروء',
      notification: updated
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/notifications/read-all
router.post('/read-all', authenticate, async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { recipientId: req.user.id, readAt: null },
      data: { readAt: new Date() }
    });

    res.json({
      success: true,
      message: 'تم تعيين جميع الإشعارات كمقروءة'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
