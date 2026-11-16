const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const config = require('../src/config');

const prisma = new PrismaClient();

async function seed() {
  console.log('[SEED] Starting database seeding...');

  // 1. Provision Administrator Account
  const adminPhone = config.adminNormalizedPhone;
  const adminPasswordHash = await bcrypt.hash(config.adminDefaultPassword, 10);

  let admin = await prisma.user.findUnique({
    where: { phone: adminPhone }
  });

  if (!admin) {
    admin = await prisma.user.create({
      data: {
        phone: adminPhone,
        passwordHash: adminPasswordHash,
        role: 'ADMIN',
        status: 'ACTIVE'
      }
    });
    console.log(`[SEED] Administrator account seeded: Phone = ${adminPhone} (Role: ADMIN)`);
  } else {
    console.log(`[SEED] Administrator account already exists: ${adminPhone}`);
  }

  // 2. Provision Initial Verified Companies
  const companyData = [
    {
      phone: '01255550001',
      password: 'CompanyPassword123!',
      companyName: 'شركة الدلتا للصناعات الهندسية',
      industry: 'صناعة وتعدين',
      location: 'كفر الشيخ، مصر',
      address: 'المنطقة الصناعية، كفر الشيخ',
      description: 'شركة متخصصة في الصيانة الصناعية والتمديدات الكهروميكانيكية.',
      publicContactPhone: '01255550001'
    },
    {
      phone: '01012345678',
      password: 'CompanyPassword123!',
      companyName: 'شركة الأفق للمقاولات والتشطيبات',
      industry: 'مقاولات وتشطيبات',
      location: 'القاهرة، مصر',
      address: 'مدينة نصر، القاهرة',
      description: 'شركة رائدة في تنفيذ أعمال الدهانات والتشطيبات المتكاملة والمباني الحديثة.',
      publicContactPhone: '01012345678'
    },
    {
      phone: '01512345678',
      password: 'CompanyPassword123!',
      companyName: 'مؤسسة النيل للخدمات الفنية',
      industry: 'خدمات وصيانة عامة',
      location: 'الجيزة، مصر',
      address: 'شارع الهرم، الجيزة',
      description: 'مؤسسة معتمدة في أعمال السباكة وشبكات التغذية والصرف والتكييف المركزي.',
      publicContactPhone: '01512345678'
    }
  ];

  const createdCompanies = [];
  for (const c of companyData) {
    let user = await prisma.user.findUnique({ where: { phone: c.phone } });
    if (!user) {
      const hash = await bcrypt.hash(c.password, 10);
      user = await prisma.user.create({
        data: {
          phone: c.phone,
          passwordHash: hash,
          role: 'COMPANY',
          status: 'ACTIVE',
          companyProfile: {
            create: {
              companyName: c.companyName,
              industry: c.industry,
              location: c.location,
              address: c.address,
              description: c.description,
              publicContactPhone: c.publicContactPhone
            }
          }
        },
        include: { companyProfile: true }
      });
      console.log(`[SEED] Seeded company: ${c.companyName}`);
    } else {
      user = await prisma.user.findUnique({
        where: { id: user.id },
        include: { companyProfile: true }
      });
    }
    createdCompanies.push(user.companyProfile);
  }

  // 3. Provision Initial Active Jobs
  const deltaCo = createdCompanies.find(c => c.companyName.includes('الدلتا'));
  const ofokCo = createdCompanies.find(c => c.companyName.includes('الأفق'));
  const nileCo = createdCompanies.find(c => c.companyName.includes('النيل'));

  const jobsData = [
    {
      companyId: deltaCo ? deltaCo.id : createdCompanies[0].id,
      title: 'فني كهرباء صناعي ودوائر تحكم',
      profession: 'كهربائي',
      description: 'مطلوب فني كهرباء صناعي بخبرة عملية في لوحات التحكم وخطوط الإنتاج والتأريض.',
      experienceLevel: 'متوسط الخبرة',
      experienceYearsMin: 3,
      location: 'كفر الشيخ، مصر',
      salary: '7500 جنيه',
      contactPhone: '01255550001'
    },
    {
      companyId: ofokCo ? ofokCo.id : createdCompanies[1].id,
      title: 'معلم نقاش وتشطيب شقق وديكورات',
      profession: 'نقاش',
      description: 'مطلوب فني دهانات شقق وديكورات حديثة، يجيد المعجون وتجهيز الحوائط والأسقف المعلقة.',
      experienceLevel: 'خبير',
      experienceYearsMin: 5,
      location: 'القاهرة، مصر',
      salary: '500 جنيه / يومياً',
      contactPhone: '01012345678'
    },
    {
      companyId: nileCo ? nileCo.id : createdCompanies[2].id,
      title: 'معلم سباك وتأسيس شبكات مياه وصحي',
      profession: 'سباك',
      description: 'مطلوب سباك تأسيس وتركيبات صحية للعمل في مواقع مشروعات بالجيزة.',
      experienceLevel: 'خبير',
      experienceYearsMin: 5,
      location: 'الجيزة، مصر',
      salary: '450 جنيه / يومياً',
      contactPhone: '01512345678'
    },
    {
      companyId: ofokCo ? ofokCo.id : createdCompanies[1].id,
      title: 'فني تبريد وتكييف (صيانة وحدات سبليت ومركزي)',
      profession: 'فني تبريد وتكييف',
      description: 'صيانة وفحص دوري لوحدات التكييف وقياس ضغوط الفريون واستبدال الفلاتر.',
      experienceLevel: 'متوسط',
      experienceYearsMin: 2,
      location: 'القاهرة، مصر',
      salary: '400 جنيه / يومياً',
      contactPhone: '01012345678'
    }
  ];

  for (const j of jobsData) {
    const existingJob = await prisma.job.findFirst({
      where: { title: j.title, companyId: j.companyId }
    });
    if (!existingJob) {
      await prisma.job.create({ data: j });
      console.log(`[SEED] Seeded job: ${j.title}`);
    }
  }

  // 4. Provision Initial Real Workers
  const workerData = [
    {
      phone: '01055550001',
      password: 'WorkerPassword123!',
      fullName: 'محمد عبد العزيز النجار',
      profession: 'فني كهرباء',
      otherProfessions: 'صيانة لوحات، قراءة مخططات',
      location: 'كفر الشيخ، مصر',
      experienceYears: 6,
      skills: 'تمديدات كهرباء، ملتيميتر، تأريض، صيانة لوحات تحكم',
      bio: 'فني كهرباء صناعي بخبرة عملية ممتازة في صيانة المصانع وتمديدات الجهد المنخفض.'
    },
    {
      phone: '01155550002',
      password: 'WorkerPassword123!',
      fullName: 'أحمد إبراهيم السيد',
      profession: 'نقاش',
      otherProfessions: 'دهان شقق، ديكورات، معجون',
      location: 'القاهرة، مصر',
      experienceYears: 10,
      skills: 'دهانات حديثة، معجون حوائط، تشطيبات داخلية، بويات دوكو',
      bio: 'معلم نقاش خبرة عشر سنوات في تشطيب الشقق والفلل وتسليم على المفتاح.'
    },
    {
      phone: '01255550003',
      password: 'WorkerPassword123!',
      fullName: 'محمود حسن علي',
      profession: 'سباك',
      otherProfessions: 'تأسيس صحي، شبكات مياه',
      location: 'الجيزة، مصر',
      experienceYears: 5,
      skills: 'شبكات بولي، تركيب مضخات، خلاطات، تأسيس حمامات ومطابخ',
      bio: 'سباك محترف في التأسيس والتشطيب والصيانة السريعة للأعطال.'
    }
  ];

  for (const w of workerData) {
    let user = await prisma.user.findUnique({ where: { phone: w.phone } });
    if (!user) {
      const hash = await bcrypt.hash(w.password, 10);
      user = await prisma.user.create({
        data: {
          phone: w.phone,
          passwordHash: hash,
          role: 'WORKER',
          status: 'ACTIVE',
          workerProfile: {
            create: {
              fullName: w.fullName,
              profession: w.profession,
              otherProfessions: w.otherProfessions,
              location: w.location,
              experienceYears: w.experienceYears,
              experience: `${w.experienceYears} سنوات`,
              skills: w.skills,
              bio: w.bio,
              assessmentScore: 85
            }
          }
        }
      });
      console.log(`[SEED] Seeded worker: ${w.fullName}`);
    }
  }

  console.log('[SEED] Seeding completed successfully!');
}

seed()
  .catch((e) => {
    console.error('[SEED_ERROR]', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
