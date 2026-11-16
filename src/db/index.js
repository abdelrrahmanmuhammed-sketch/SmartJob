const { PrismaClient } = require('@prisma/client');
const path = require('path');

const resolvedDbPath = path.resolve(__dirname, '../../prisma/dev.db').replace(/\\/g, '/');
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('./dev.db')) {
  process.env.DATABASE_URL = `file:${resolvedDbPath}`;
}

let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient({
    datasources: {
      db: { url: process.env.DATABASE_URL }
    }
  });
} else {
  if (!global.prisma) {
    global.prisma = new PrismaClient({
      datasources: {
        db: { url: process.env.DATABASE_URL }
      },
      log: ['error', 'warn']
    });
  }
  prisma = global.prisma;
}

module.exports = prisma;
