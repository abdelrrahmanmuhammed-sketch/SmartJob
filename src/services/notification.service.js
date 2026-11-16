const prisma = require('../db');

// In-memory registry of active SSE connections: userId -> Set of res objects
const activeClients = new Map();

function addClient(userId, res) {
  if (!activeClients.has(userId)) {
    activeClients.set(userId, new Set());
  }
  activeClients.get(userId).add(res);

  res.on('close', () => {
    removeClient(userId, res);
  });
}

function removeClient(userId, res) {
  if (activeClients.has(userId)) {
    activeClients.get(userId).delete(res);
    if (activeClients.get(userId).size === 0) {
      activeClients.delete(userId);
    }
  }
}

function isUserOnline(userId) {
  return activeClients.has(userId) && activeClients.get(userId).size > 0;
}

async function createNotification({ recipientId, eventType, title, message, relatedRecordId = null, metadata = null }) {
  // 1. Always persist in PostgreSQL / SQLite database
  const notification = await prisma.notification.create({
    data: {
      recipientId,
      eventType,
      title,
      message,
      relatedRecordId,
      metadata: metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null
    }
  });

  // 2. Real-time delivery if recipient is online
  if (activeClients.has(recipientId)) {
    const clients = activeClients.get(recipientId);
    const payload = JSON.stringify(notification);
    for (const res of clients) {
      try {
        res.write(`data: ${payload}\n\n`);
      } catch (err) {
        console.error('[SSE_DELIVERY_ERROR]', err.message);
      }
    }
  }

  return notification;
}

// Notify all Admins about an event (e.g. Worker Registered)
async function notifyAdmins({ eventType, title, message, relatedRecordId = null, metadata = null }) {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true }
  });

  const createdNotifications = [];
  for (const admin of admins) {
    const n = await createNotification({
      recipientId: admin.id,
      eventType,
      title,
      message,
      relatedRecordId,
      metadata
    });
    createdNotifications.push(n);
  }
  return createdNotifications;
}

module.exports = {
  addClient,
  removeClient,
  isUserOnline,
  createNotification,
  notifyAdmins
};
