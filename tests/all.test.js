const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');
const config = require('../src/config');
const prisma = require('../src/db');
const bcrypt = require('bcryptjs');

// Simple HTTP request helper using node http / supertest-like approach
async function request(method, path, body = null, token = null) {
  const url = `http://127.0.0.1:${config.port}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  return { status: res.status, body: data };
}

let server;

test.before(async () => {
  // Start test server
  server = app.listen(config.port);
});

test.after(async () => {
  if (server) server.close();
  await prisma.$disconnect();
});

test('1. Public Contact Number Separation: Must be exactly 01154093079 and different from admin sign-in phone', async () => {
  const res = await request('GET', '/api/public/config');
  assert.equal(res.status, 200);
  assert.equal(res.body.publicAdContactNumber, '01154093079');
  assert.notEqual(res.body.publicAdContactNumber, config.adminPhone);
  assert.notEqual(res.body.publicAdContactNumber, config.adminNormalizedPhone);
});

test('2. Admin Sign-In: Admin signs in with +20 15 05677212 and secure password; protected from public registration', async () => {
  // Try public registration with admin phone -> Must be blocked
  const regAttempt = await request('POST', '/api/auth/register/worker', {
    phone: '+20 15 05677212',
    password: 'Password123!',
    fullName: 'Fake Admin',
    profession: 'ادمن',
    location: 'القاهرة'
  });
  assert.equal(regAttempt.status, 403);

  // Admin login with configured phone and password
  const loginRes = await request('POST', '/api/auth/login', {
    phone: '+20 15 05677212',
    password: config.adminDefaultPassword
  });
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.body.user.role, 'ADMIN');
  assert.ok(loginRes.body.token);

  // Verify Admin can access /api/admin/overview
  const adminOverview = await request('GET', '/api/admin/overview', null, loginRes.body.token);
  assert.equal(adminOverview.status, 200);
  assert.ok(adminOverview.body.metrics.totalWorkers >= 0);
  assert.ok(adminOverview.body.metrics.totalCompanies >= 0);
});

test('3. Worker Registration: Persists in DB and automatically generates persistent Admin Alert', async () => {
  const testPhone = '01099998877';

  // Cleanup if exists from previous test run
  await prisma.user.deleteMany({ where: { phone: testPhone } });

  // Get admin unread count before registration
  const adminUser = await prisma.user.findUnique({ where: { phone: config.adminNormalizedPhone } });
  const notifCountBefore = await prisma.notification.count({ where: { recipientId: adminUser.id } });

  const regRes = await request('POST', '/api/auth/register/worker', {
    phone: testPhone,
    password: 'WorkerSecurePass123!',
    fullName: 'سعيد عبد الله السباك',
    profession: 'سباك',
    location: 'كفر الشيخ',
    experienceYears: 4,
    skills: 'صحي، مواسير'
  });

  assert.equal(regRes.status, 201);
  assert.equal(regRes.body.user.role, 'WORKER');
  assert.ok(regRes.body.token);

  // Verify record in database
  const workerInDb = await prisma.workerProfile.findFirst({
    where: { fullName: 'سعيد عبد الله السباك' },
    include: { user: true }
  });
  assert.ok(workerInDb);
  assert.equal(workerInDb.user.phone, testPhone);

  // Verify Admin Notification was created and persisted in DB
  const notifCountAfter = await prisma.notification.count({ where: { recipientId: adminUser.id } });
  assert.ok(notifCountAfter > notifCountBefore, 'Admin notification count should increase');

  const latestNotif = await prisma.notification.findFirst({
    where: { recipientId: adminUser.id, eventType: 'WORKER_REGISTERED' },
    orderBy: { createdAt: 'desc' }
  });
  assert.ok(latestNotif);
  assert.ok(latestNotif.message.includes('سعيد عبد الله السباك'));

  // Cleanup test user
  await prisma.user.delete({ where: { id: workerInDb.userId } });
});

test('4. Security & RBAC: Worker cannot post job or access Admin endpoints', async () => {
  // Login as existing seeded worker
  const loginRes = await request('POST', '/api/auth/login', {
    phone: '01055550001',
    password: 'WorkerPassword123!'
  });
  assert.equal(loginRes.status, 200);
  const workerToken = loginRes.body.token;

  // Try accessing Admin overview -> Must be 403
  const adminRes = await request('GET', '/api/admin/overview', null, workerToken);
  assert.equal(adminRes.status, 403);

  // Try creating a job -> Must be 403 (Worker role is not company)
  const jobRes = await request('POST', '/api/jobs', {
    title: 'وظيفة غير مصرح بها',
    profession: 'كهربائي',
    experienceLevel: 'متوسط'
  }, workerToken);
  assert.equal(jobRes.status, 403);
});

test('5. Company Workflow: Company posts job, Worker applies, Company reviews and updates status', async () => {
  // Login as Company
  const coLogin = await request('POST', '/api/auth/login', {
    phone: '01255550001',
    password: 'CompanyPassword123!'
  });
  assert.equal(coLogin.status, 200);
  const coToken = coLogin.body.token;

  // Post a new job
  const jobRes = await request('POST', '/api/jobs', {
    title: 'فني صيانة خطوط إنتاج',
    profession: 'فني ميكانيكا',
    description: 'مطلوب فني صيانة خطوط لمصنع بكفر الشيخ',
    experienceLevel: 'متوسط',
    experienceYearsMin: 3,
    location: 'كفر الشيخ، مصر',
    salary: '8000 جنيه'
  }, coToken);

  assert.equal(jobRes.status, 201);
  const createdJob = jobRes.body.job;
  assert.ok(createdJob.id);

  // Login as Worker
  const wLogin = await request('POST', '/api/auth/login', {
    phone: '01055550001',
    password: 'WorkerPassword123!'
  });
  const wToken = wLogin.body.token;

  // Worker applies for the job
  const appRes = await request('POST', `/api/jobs/${createdJob.id}/applications`, {}, wToken);
  assert.equal(appRes.status, 201);
  const application = appRes.body.application;
  assert.equal(application.status, 'UNDER_REVIEW');

  // Duplicate application should be rejected
  const dupRes = await request('POST', `/api/jobs/${createdJob.id}/applications`, {}, wToken);
  assert.equal(dupRes.status, 409);

  // Company reviews application and accepts
  const updateRes = await request('PATCH', `/api/applications/${application.id}/status`, {
    status: 'ACCEPTED',
    employerNotes: 'تم قبول طلبك وسيتم الاتصال للمقابلة'
  }, coToken);
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.application.status, 'ACCEPTED');

  // Verify Worker received notification
  const workerUser = await prisma.user.findUnique({ where: { phone: '01055550001' } });
  const workerNotif = await prisma.notification.findFirst({
    where: { recipientId: workerUser.id, eventType: 'APPLICATION_STATUS_CHANGED' },
    orderBy: { createdAt: 'desc' }
  });
  assert.ok(workerNotif);
  assert.ok(workerNotif.title.includes('فني صيانة خطوط إنتاج'));

  // Cleanup created job & application
  await prisma.job.delete({ where: { id: createdJob.id } });
});

test('6. Voice Search Accuracy: Company voice search for workers returns real database records', async () => {
  // Query: "عايز فني كهرباء في كفر الشيخ خبرة 5 سنين"
  const searchRes = await request('POST', '/api/search/voice', {
    transcript: 'عايز فني كهرباء في كفر الشيخ خبرة 5 سنين',
    defaultTarget: 'workers'
  });

  assert.equal(searchRes.status, 200);
  assert.equal(searchRes.body.target, 'workers');
  assert.equal(searchRes.body.intent.profession, 'كهربائي');
  assert.equal(searchRes.body.intent.location, 'كفر الشيخ');
  assert.ok(searchRes.body.results.length > 0);

  // First result must be Muhammad Abd El-Aziz (Electrician in Kafr El-Sheikh, 6 years exp)
  const topMatch = searchRes.body.results[0];
  assert.equal(topMatch.fullName, 'محمد عبد العزيز النجار');
  assert.equal(topMatch.location, 'كفر الشيخ، مصر');
  assert.ok(topMatch.isExactMatch);
});

test('7. Voice Search Accuracy: Worker voice search for jobs returns real database records', async () => {
  // Query: "بدور على شغل نقاش في القاهرة"
  const searchRes = await request('POST', '/api/search/voice', {
    transcript: 'بدور على شغل نقاش في القاهرة',
    defaultTarget: 'jobs'
  });

  assert.equal(searchRes.status, 200);
  assert.equal(searchRes.body.target, 'jobs');
  assert.equal(searchRes.body.intent.profession, 'نقاش');
  assert.equal(searchRes.body.intent.location, 'القاهرة');
  assert.ok(searchRes.body.results.length > 0);

  // Top result must be the painting job in Cairo
  const topMatch = searchRes.body.results[0];
  assert.ok(topMatch.title.includes('نقاش'));
  assert.ok(topMatch.location.includes('القاهرة'));
});

test('8. Data Integrity: Changing phone number transactionally preserves foreign key relationships', async () => {
  // Login as existing seeded worker
  const loginRes = await request('POST', '/api/auth/login', {
    phone: '01255550003', // Mahmoud Hassan
    password: 'WorkerPassword123!'
  });
  const token = loginRes.body.token;
  const originalId = loginRes.body.user.id;

  const newTestPhone = '01299991122';
  await prisma.user.deleteMany({ where: { phone: newTestPhone } });

  // Change phone number
  const changeRes = await request('POST', '/api/me/change-phone', {
    newPhone: newTestPhone
  }, token);
  assert.equal(changeRes.status, 200);
  assert.equal(changeRes.body.phone, newTestPhone);

  // Verify user ID remained stable and profile is still intact
  const updatedUser = await prisma.user.findUnique({
    where: { id: originalId },
    include: { workerProfile: true }
  });
  assert.equal(updatedUser.phone, newTestPhone);
  assert.equal(updatedUser.workerProfile.fullName, 'محمود حسن علي');

  // Restore phone back to original
  await prisma.user.update({
    where: { id: originalId },
    data: { phone: '01255550003' }
  });
});

test('9. Production Metrics: Dashboard metrics calculated from real DB records without demo padding', async () => {
  const adminLogin = await request('POST', '/api/auth/login', {
    phone: '+20 15 05677212',
    password: config.adminDefaultPassword
  });
  const token = adminLogin.body.token;

  const res = await request('GET', '/api/admin/overview', null, token);
  assert.equal(res.status, 200);

  const [dbWorkers, dbCompanies, dbJobs] = await Promise.all([
    prisma.workerProfile.count(),
    prisma.companyProfile.count(),
    prisma.job.count({ where: { status: 'ACTIVE' } })
  ]);

  assert.equal(res.body.metrics.totalWorkers, dbWorkers);
  assert.equal(res.body.metrics.totalCompanies, dbCompanies);
  assert.equal(res.body.metrics.totalJobs, dbJobs);
});
