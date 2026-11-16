const prisma = require('../db');
const { detectCraft, detectLocation, detectExperienceYears, normalizeArabic } = require('../utils/arabic.utils');

function extractVoiceIntent(transcript, defaultTarget = 'jobs') {
  if (!transcript || typeof transcript !== 'string') {
    return {
      target: defaultTarget,
      profession: '',
      location: '',
      experienceYearsMin: 0,
      availability: 'full_time',
      keywords: []
    };
  }

  const norm = normalizeArabic(transcript);

  // Target detection: if the user explicitly asks for workers/craftsmen, or if company mode
  let target = defaultTarget;
  if (norm.includes('عايز عامل') || norm.includes('محتاج فني') || norm.includes('محتاجين') || norm.includes('مطلوب فني') || norm.includes('عايز صنايعي') || norm.includes('نحتاج عمال')) {
    target = 'workers';
  } else if (norm.includes('بدور على شغل') || norm.includes('عايز وظيفه') || norm.includes('فرص عمل') || norm.includes('شركات بتطلب')) {
    target = 'jobs';
  }

  const detectedCraft = detectCraft(transcript);
  const detectedLocation = detectLocation(transcript);
  const experienceYearsMin = detectExperienceYears(transcript);

  let availability = 'full_time';
  if (norm.includes('دوام جزئي') || norm.includes('نصف وقت')) {
    availability = 'part_time';
  } else if (norm.includes('باليوميه') || norm.includes('عقد') || norm.includes('مؤقت')) {
    availability = 'contract';
  }

  return {
    target,
    profession: detectedCraft ? detectedCraft.canonical : '',
    professionLabel: detectedCraft ? detectedCraft.label : '',
    craftKey: detectedCraft ? detectedCraft.key : null,
    craftSynonyms: detectedCraft ? detectedCraft.synonyms : [],
    location: detectedLocation || '',
    experienceYearsMin,
    availability,
    rawTranscript: transcript
  };
}

async function executeStructuredSearch(intent) {
  const { target, profession, location, experienceYearsMin, craftKey, craftSynonyms } = intent;

  if (target === 'workers') {
    // 1. Search Real Worker Profiles from Database
    const allWorkers = await prisma.workerProfile.findMany({
      where: {
        user: { status: 'ACTIVE' }
      },
      include: {
        user: {
          select: { id: true, phone: true, createdAt: true }
        },
        certificates: true
      }
    });

    const scored = allWorkers.map(w => {
      let score = 0;
      const matchedCriteria = [];
      const unmatchedCriteria = [];

      const wProfNorm = normalizeArabic(w.profession + ' ' + (w.otherProfessions || '') + ' ' + w.skills);
      const wLocNorm = normalizeArabic(w.location);

      // Profession matching
      if (profession) {
        const pNorm = normalizeArabic(profession);
        const craftMatches = wProfNorm.includes(pNorm) ||
          (craftSynonyms && craftSynonyms.some(s => wProfNorm.includes(normalizeArabic(s)))) ||
          (craftKey && detectCraft(w.profession)?.key === craftKey);

        if (craftMatches) {
          score += 50;
          matchedCriteria.push('المهنة والتخصص');
        } else {
          unmatchedCriteria.push('المهنة');
        }
      }

      // Location matching
      if (location) {
        const lNorm = normalizeArabic(location);
        if (wLocNorm.includes(lNorm)) {
          score += 30;
          matchedCriteria.push('الموقع / المحافظة');
        } else {
          unmatchedCriteria.push('الموقع');
        }
      }

      // Experience matching
      if (experienceYearsMin > 0) {
        if (w.experienceYears >= experienceYearsMin) {
          score += 20;
          matchedCriteria.push(`الخبرة المطلوبة (${experienceYearsMin} سنوات فأكثر)`);
        } else {
          unmatchedCriteria.push(`الخبرة (المتوفرة ${w.experienceYears} سنوات)`);
        }
      }

      // If no criteria specified, base match
      if (!profession && !location && experienceYearsMin === 0) {
        score = 60;
        matchedCriteria.push('عرض عام');
      }

      const isExactMatch = (score >= 80) || (!unmatchedCriteria.length && score > 0);

      return {
        id: w.id,
        userId: w.userId,
        fullName: w.fullName,
        phone: w.user.phone,
        profession: w.profession,
        location: w.location,
        experienceYears: w.experienceYears,
        experience: w.experience || `${w.experienceYears} سنوات`,
        skills: w.skills,
        bio: w.bio,
        assessmentScore: w.assessmentScore,
        matchScore: Math.min(score, 100),
        isExactMatch,
        matchedCriteria,
        unmatchedCriteria
      };
    });

    // Filter relevant matches
    const matches = scored.filter(s => s.matchScore >= 30).sort((a, b) => b.matchScore - a.matchScore);
    const exactMatches = matches.filter(m => m.isExactMatch);
    const partialMatches = matches.filter(m => !m.isExactMatch);

    return {
      target: 'workers',
      intent,
      totalCount: matches.length,
      exactCount: exactMatches.length,
      partialCount: partialMatches.length,
      results: matches,
      message: matches.length
        ? `تم العثور على ${matches.length} فني مطابق (${exactMatches.length} تطابق تام، ${partialMatches.length} تطابق جزئي).`
        : 'لم يتم العثور على عمال مطابقين للشروط المطلوبة في قاعدة البيانات حالياً.'
    };
  } else {
    // 2. Search Real Active Jobs from Database
    const allJobs = await prisma.job.findMany({
      where: {
        status: 'ACTIVE'
      },
      include: {
        company: {
          select: { id: true, companyName: true, location: true, publicContactPhone: true }
        }
      }
    });

    const scored = allJobs.map(j => {
      let score = 0;
      const matchedCriteria = [];
      const unmatchedCriteria = [];

      const jProfNorm = normalizeArabic(j.profession + ' ' + j.title + ' ' + j.description);
      const jLocNorm = normalizeArabic(j.location);

      // Profession matching
      if (profession) {
        const pNorm = normalizeArabic(profession);
        const craftMatches = jProfNorm.includes(pNorm) ||
          (craftSynonyms && craftSynonyms.some(s => jProfNorm.includes(normalizeArabic(s)))) ||
          (craftKey && detectCraft(j.profession + ' ' + j.title)?.key === craftKey);

        if (craftMatches) {
          score += 50;
          matchedCriteria.push('المهنة');
        } else {
          unmatchedCriteria.push('المهنة');
        }
      }

      // Location matching
      if (location) {
        const lNorm = normalizeArabic(location);
        if (jLocNorm.includes(lNorm)) {
          score += 30;
          matchedCriteria.push('الموقع');
        } else {
          unmatchedCriteria.push('الموقع');
        }
      }

      // Experience matching
      if (experienceYearsMin > 0) {
        if (j.experienceYearsMin <= experienceYearsMin) {
          score += 20;
          matchedCriteria.push('مستوى الخبرة');
        } else {
          unmatchedCriteria.push(`الخبرة المطلوبة (${j.experienceYearsMin} سنوات)`);
        }
      }

      if (!profession && !location && experienceYearsMin === 0) {
        score = 60;
        matchedCriteria.push('عرض عام');
      }

      const isExactMatch = (score >= 80) || (!unmatchedCriteria.length && score > 0);

      return {
        id: j.id,
        title: j.title,
        profession: j.profession,
        companyName: j.company.companyName,
        companyId: j.company.id,
        location: j.location,
        salary: j.salary || 'حسب الاتفاق',
        experienceLevel: j.experienceLevel,
        experienceYearsMin: j.experienceYearsMin,
        contactPhone: j.contactPhone || j.company.publicContactPhone,
        description: j.description,
        createdAt: j.createdAt,
        matchScore: Math.min(score, 100),
        isExactMatch,
        matchedCriteria,
        unmatchedCriteria
      };
    });

    const matches = scored.filter(s => s.matchScore >= 30).sort((a, b) => b.matchScore - a.matchScore);
    const exactMatches = matches.filter(m => m.isExactMatch);
    const partialMatches = matches.filter(m => !m.isExactMatch);

    return {
      target: 'jobs',
      intent,
      totalCount: matches.length,
      exactCount: exactMatches.length,
      partialCount: partialMatches.length,
      results: matches,
      message: matches.length
        ? `تم العثور على ${matches.length} فرصة عمل مطابقة (${exactMatches.length} تطابق تام، ${partialMatches.length} تطابق جزئي).`
        : 'لم يتم العثور على وظائف منشورة مطابقة للشروط المطلوبة في قاعدة البيانات حالياً.'
    };
  }
}

module.exports = {
  extractVoiceIntent,
  executeStructuredSearch
};
