const express = require('express');
const prisma = require('../db');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();
router.use(authenticate);

// Helper to create stable conversation ID
function getConversationId(userId1, userId2) {
  return [userId1, userId2].sort().join('_');
}

// GET /api/messages/conversations
router.get('/conversations', async (req, res, next) => {
  try {
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: req.user.id },
          { recipientId: req.user.id }
        ]
      },
      orderBy: { sentAt: 'desc' },
      include: {
        sender: {
          select: {
            id: true, phone: true, role: true,
            workerProfile: { select: { fullName: true } },
            companyProfile: { select: { companyName: true } }
          }
        },
        recipient: {
          select: {
            id: true, phone: true, role: true,
            workerProfile: { select: { fullName: true } },
            companyProfile: { select: { companyName: true } }
          }
        }
      }
    });

    const conversationMap = new Map();
    for (const msg of messages) {
      if (!conversationMap.has(msg.conversationId)) {
        const otherParty = msg.senderId === req.user.id ? msg.recipient : msg.sender;
        const otherName = otherParty.workerProfile?.fullName || otherParty.companyProfile?.companyName || otherParty.phone;
        conversationMap.set(msg.conversationId, {
          conversationId: msg.conversationId,
          lastMessage: msg.content,
          sentAt: msg.sentAt,
          otherParty: {
            id: otherParty.id,
            name: otherName,
            role: otherParty.role,
            phone: otherParty.phone
          }
        });
      }
    }

    res.json({
      success: true,
      data: Array.from(conversationMap.values())
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/messages/:conversationId
router.get('/:conversationId', async (req, res, next) => {
  try {
    const messages = await prisma.message.findMany({
      where: {
        conversationId: req.params.conversationId,
        OR: [
          { senderId: req.user.id },
          { recipientId: req.user.id }
        ]
      },
      orderBy: { sentAt: 'asc' }
    });

    res.json({
      success: true,
      data: messages
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/messages
router.post('/', async (req, res, next) => {
  try {
    const { recipientId, content } = req.body;

    if (!recipientId || !content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'المستلم والرسالة مطلوبان' });
    }

    const recipient = await prisma.user.findUnique({
      where: { id: recipientId }
    });

    if (!recipient) {
      return res.status(404).json({ success: false, message: 'المستخدم المستلم غير موجود' });
    }

    const conversationId = getConversationId(req.user.id, recipientId);

    const message = await prisma.message.create({
      data: {
        senderId: req.user.id,
        recipientId,
        conversationId,
        content: content.trim()
      }
    });

    res.status(201).json({
      success: true,
      message
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
