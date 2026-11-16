const config = require('../config');
const prisma = require('../db');
const { detectCraft, detectLocation, detectExperienceYears, normalizeArabic } = require('../utils/arabic.utils');

const PROMPTS = {
  WORKER_MATCHING: `You are an AI matching engine for a blue-collar job platform in Egypt.
Analyze the worker's skills, experience, and preferred location from the input text,
and match them with the most relevant job postings from companies.
Return the matched job IDs ordered by relevance in valid JSON format.
Only use job postings provided in the input. Do not invent job IDs or job details.
If there are no suitable matches, return an empty list.
Respond ONLY with a JSON object in this format:
{
  "matchedJobIds": ["id1", "id2"],
  "extracted": {
    "profession": "craft name in Arabic",
    "location": "governorate/city in Arabic or null",
    "experienceYears": number or 0,
    "skills": ["skill1", "skill2"]
  },
  "relevanceReason": "short explanation in Arabic",
  "clarificationQuestion": "short question in Arabic if essential details are missing, else null"
}`,

  EMPLOYER_JOB_AD: `You are an HR assistant for a blue-collar recruitment platform.
Help the employer generate a clear, attractive job posting based on their brief description,
including the required craft, daily/weekly wage, working hours, and location.
Keep the language simple and direct.
Do not invent missing facts. Clearly list any important information the employer still needs to provide.
Return the result in a structured format that the application can display and edit.
Respond ONLY with a JSON object in this format:
{
  "title": "Clear job title in Arabic",
  "profession": "Craft category in Arabic",
  "description": "Professional attractive job description in Arabic",
  "location": "Location if specified or null",
  "salary": "Wage amount and period if specified or null",
  "workingHours": "Hours/shifts if specified or null",
  "experienceLevel": "e.g. مبتدئ / متوسط / خبير",
  "experienceYearsMin": number,
  "missingFields": ["list of important missing items like hours, exact location, or wage"],
  "clarifyingQuestions": ["friendly follow-up questions for employer to complete the post"]
}`,

  APPLICANT_REVIEW: `You are an assistant helping an employer review applicants for a specific blue-collar job.
Compare the applicant information only with the job requirements provided.
Summarize relevant experience and skills, identify requirements that are demonstrated,
not demonstrated, or unclear, and explain the assessment using evidence from the application.
Do not infer protected or sensitive personal characteristics.
Do not make an automatic hiring or rejection decision.
If information is missing, say that it is missing and recommend a follow-up question.
Return a concise, structured result for human review.
Respond ONLY with a JSON object in this format:
{
  "summary": "Objective summary of applicant's stated skills and experience",
  "demonstratedRequirements": ["requirement 1 met with evidence", "..."],
  "notDemonstratedRequirements": ["requirement not met or absent from profile", "..."],
  "unclearRequirements": ["requirement that needs verification", "..."],
  "matchRating": "strong_match" | "moderate_match" | "needs_further_review",
  "explanation": "Clear, objective job-related rationale based solely on evidence",
  "missingInfoRecommendation": "Recommended interview questions to clarify missing details",
  "humanReviewNote": "قرار التوظيف النهائي يرجع لصاحب العمل بعد المقابلة الشخصية والتقييم العملي"
}`,

  SPOKEN_JOB_SUMMARY: `You are a helpful voice assistant for Arab blue-collar workers who cannot read.
Summarize the top matched job posting into one short, clear, and polite sentence
in simple Modern Standard Arabic.
Mention ONLY: the job title/craft, the location, and the daily or monthly wage.
Avoid complex vocabulary, symbols, and English words so the Text-to-Speech engine
pronounces the sentence clearly.
End with a simple question asking if the worker wants to apply.
Do not invent missing information. If wage or location is unavailable, do not fabricate it.`
};

/**
 * Call OpenAI Chat Completions API with structured JSON output
 */
async function callOpenAi(systemPrompt, userContent) {
  if (!config.openaiApiKey) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.openaiApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3
      })
    });

    if (!res.ok) {
      console.warn(`[OPENAI_API_ERROR] Status: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) return null;

    return JSON.parse(rawContent);
  } catch (error) {
    console.warn('[OPENAI_CALL_FAILED]', error.message);
    return null;
  }
}

/**
 * Call Gemini API when configured
 */
async function callGemini(systemPrompt, userContent) {
  if (!config.geminiApiKey) return null;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.geminiApiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\nUser input: ${userContent}` }] }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.3
        }
      })
    });

    if (!res.ok) {
      console.warn(`[GEMINI_API_ERROR] Status: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawContent) return null;

    return JSON.parse(rawContent);
  } catch (error) {
    console.warn('[GEMINI_CALL_FAILED]', error.message);
    return null;
  }
}

/**
 * High-accuracy fallback extractor for Egyptian dialect & Arabic text
 */
function localExtractWorkerDetails(text) {
  const norm = normalizeArabic(text);
  const detectedCraft = detectCraft(text);
  const detectedLoc = detectLocation(text);
  const expYears = detectExperienceYears(text);

  const missing = [];
  if (!detectedCraft) missing.push('المهنة أو الحرفة المطلوبة');
  if (!detectedLoc) missing.push('المحافظة أو المدينة المفضلة');

  let clarificationQuestion = null;
  if (!detectedCraft) {
    clarificationQuestion = 'ما هي مهنتك أو تخصصك الفني بالتحديد؟ (مثلاً: نقاش، سباك، كهربائي)';
  } else if (!detectedLoc) {
    clarificationQuestion = `تمام يا فنان! تحب ندوّرلك على شغل ${detectedCraft.canonical} في أي محافظة أو مدينة؟`;
  }

  return {
    profession: detectedCraft ? detectedCraft.canonical : '',
    professionLabel: detectedCraft ? detectedCraft.label : '',
    craftKey: detectedCraft ? detectedCraft.key : null,
    location: detectedLoc || '',
    experienceYears: expYears,
    skills: detectedCraft ? detectedCraft.synonyms.slice(0, 4) : [],
    clarificationQuestion
  };
}

/**
 * AI Worker Matching Engine
 * Uses AI model (OpenAI/Gemini) with real DB jobs input, backed by reliable validation and local ranking.
 */
async function matchWorkerWithJobs(workerQuery) {
  if (!workerQuery || typeof workerQuery !== 'string' || !workerQuery.trim()) {
    return {
      success: false,
      message: 'يرجى تقديم تفاصيل البحث الصوتي أو النصي',
      matchedJobs: [],
      extracted: {}
    };
  }

  // 1. Fetch real active jobs from platform database
  const activeJobs = await prisma.job.findMany({
    where: { status: 'ACTIVE' },
    include: {
      company: {
        select: { id: true, companyName: true, location: true, publicContactPhone: true }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 40
  });

  const jobsPayload = activeJobs.map(j => ({
    id: j.id,
    title: j.title,
    profession: j.profession,
    location: j.location,
    salary: j.salary || 'حسب الاتفاق',
    experienceYearsMin: j.experienceYearsMin,
    description: j.description
  }));

  // 2. Local baseline extraction
  const localExtracted = localExtractWorkerDetails(workerQuery);

  // 3. Try LLM Matching
  let aiResult = null;
  if (config.openaiApiKey) {
    const promptContent = `Worker input: "${workerQuery}"\n\nAvailable Active Job Postings:\n${JSON.stringify(jobsPayload)}`;
    aiResult = await callOpenAi(PROMPTS.WORKER_MATCHING, promptContent);
  } else if (config.geminiApiKey) {
    const promptContent = `Worker input: "${workerQuery}"\n\nAvailable Active Job Postings:\n${JSON.stringify(jobsPayload)}`;
    aiResult = await callGemini(PROMPTS.WORKER_MATCHING, promptContent);
  }

  let matchedJobIds = [];
  let extracted = localExtracted;
  let relevanceReason = '';
  let clarificationQuestion = localExtracted.clarificationQuestion;

  if (aiResult && Array.isArray(aiResult.matchedJobIds)) {
    // Validate that every returned job ID actually exists in our active database records
    const validActiveIds = new Set(activeJobs.map(j => j.id));
    matchedJobIds = aiResult.matchedJobIds.filter(id => validActiveIds.has(id));

    if (aiResult.extracted) {
      extracted = {
        ...localExtracted,
        ...aiResult.extracted,
        profession: aiResult.extracted.profession || localExtracted.profession,
        location: aiResult.extracted.location || localExtracted.location,
        experienceYears: aiResult.extracted.experienceYears || localExtracted.experienceYears
      };
    }
    relevanceReason = aiResult.relevanceReason || '';
    if (aiResult.clarificationQuestion) {
      clarificationQuestion = aiResult.clarificationQuestion;
    }
  }

  // 4. Fallback or augment with deterministic ranking if AI returned empty or wasn't available
  if (!matchedJobIds.length && activeJobs.length) {
    const pNorm = normalizeArabic(extracted.profession);
    const lNorm = normalizeArabic(extracted.location);

    const scored = activeJobs.map(j => {
      let score = 0;
      const matchedCriteria = [];
      const jProfNorm = normalizeArabic(j.profession + ' ' + j.title + ' ' + (j.description || ''));
      const jLocNorm = normalizeArabic(j.location);

      if (pNorm && (jProfNorm.includes(pNorm) || (extracted.craftKey && detectCraft(j.profession + ' ' + j.title)?.key === extracted.craftKey))) {
        score += 50;
        matchedCriteria.push('المهنة');
      }
      if (lNorm && jLocNorm.includes(lNorm)) {
        score += 30;
        matchedCriteria.push('الموقع');
      }
      if (extracted.experienceYears > 0 && j.experienceYearsMin <= extracted.experienceYears) {
        score += 20;
        matchedCriteria.push('سنوات الخبرة');
      }
      if (!pNorm && !lNorm) {
        score = 40;
      }
      return { job: j, score, matchedCriteria };
    });

    const filtered = scored.filter(s => s.score >= 30).sort((a, b) => b.score - a.score);
    matchedJobIds = filtered.map(f => f.job.id);
    if (!relevanceReason && matchedJobIds.length) {
      relevanceReason = `تم ترتيب الوظائف بناءً على توافق المهنة (${extracted.profession || 'المطلوبة'}) والموقع (${extracted.location || 'المتاح'}).`;
    }
  }

  // 5. Construct matched job objects in exact relevance order
  const jobMap = new Map(activeJobs.map(j => [j.id, j]));
  const orderedJobs = matchedJobIds.map(id => {
    const j = jobMap.get(id);
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
      createdAt: j.createdAt
    };
  });

  return {
    success: true,
    workerQuery,
    extracted,
    clarificationQuestion,
    totalMatches: orderedJobs.length,
    relevanceReason: relevanceReason || (orderedJobs.length ? 'تمت المطابقة بنجاح من قاعدة البيانات الفعلية.' : 'لا توجد وظائف حالية مطابقة للمواصفات.'),
    matchedJobs: orderedJobs
  };
}

/**
 * AI Job Advertisement Generator for Employers
 */
async function generateJobAdvertisement(briefText) {
  if (!briefText || typeof briefText !== 'string' || !briefText.trim()) {
    throw new Error('يرجى تقديم وصف مختصر أو فكرة الإعلان');
  }

  // 1. Try LLM Generation
  let aiResult = null;
  if (config.openaiApiKey) {
    aiResult = await callOpenAi(PROMPTS.EMPLOYER_JOB_AD, `Employer brief: "${briefText.trim()}"`);
  } else if (config.geminiApiKey) {
    aiResult = await callGemini(PROMPTS.EMPLOYER_JOB_AD, `Employer brief: "${briefText.trim()}"`);
  }

  if (aiResult && aiResult.title) {
    return {
      title: aiResult.title,
      profession: aiResult.profession || 'فني مهني',
      description: aiResult.description || briefText.trim(),
      location: aiResult.location || null,
      salary: aiResult.salary || null,
      workingHours: aiResult.workingHours || null,
      experienceLevel: aiResult.experienceLevel || 'متوسط',
      experienceYearsMin: typeof aiResult.experienceYearsMin === 'number' ? aiResult.experienceYearsMin : 2,
      missingFields: Array.isArray(aiResult.missingFields) ? aiResult.missingFields : [],
      clarifyingQuestions: Array.isArray(aiResult.clarifyingQuestions) ? aiResult.clarifyingQuestions : []
    };
  }

  // 2. Deterministic Fallback Generator
  const craft = detectCraft(briefText);
  const location = detectLocation(briefText);
  const expYears = detectExperienceYears(briefText);

  // Extract wage if mentioned
  let salary = null;
  const wageMatch = briefText.match(/(\d+)\s*(جنيه|ج|جنية)/i);
  if (wageMatch) {
    const isDaily = briefText.includes('يوم') || briefText.includes('يومية');
    salary = `${wageMatch[1]} جنيه ${isDaily ? 'يومياً' : 'شهرياً'}`;
  }

  // Check missing facts without inventing
  const missingFields = [];
  const clarifyingQuestions = [];

  if (!salary) {
    missingFields.push('قيمة الأجر (اليومي أو الشهري)');
    clarifyingQuestions.push('ما هي اليومية أو الراتب المحدد للوظيفة؟');
  }
  if (!location) {
    missingFields.push('مقر أو موقع العمل التفصيلي');
    clarifyingQuestions.push('أين يقع مكان العمل بالتحديد (المحافظة أو المنطقة)؟');
  }
  if (!briefText.includes('ساعة') && !briefText.includes('شفت') && !briefText.includes('دوام')) {
    missingFields.push('ساعات العمل ومواعيد الورديات');
    clarifyingQuestions.push('ما هي ساعات العمل المقررة وأيام العطلة الأسبوعية؟');
  }

  const title = craft ? `مطلوب ${craft.label}` : `فرصة عمل فنية: ${briefText.slice(0, 30)}`;
  const description = `تعلن المنشأة عن حاجتها إلى ${craft ? craft.label : 'فني محترف'} للعمل الفوري. الشروط: الجدية والالتزام بمعايير السلامة والجودة.\nتفاصيل إضافية: ${briefText.trim()}`;

  return {
    title,
    profession: craft ? craft.canonical : 'فني مهني',
    description,
    location: location || null,
    salary: salary || null,
    workingHours: null,
    experienceLevel: expYears >= 5 ? 'خبير' : (expYears >= 2 ? 'متوسط' : 'مبتدئ'),
    experienceYearsMin: expYears,
    missingFields,
    clarifyingQuestions
  };
}

/**
 * AI Applicant Review & Fair Evaluation
 */
async function evaluateApplicant({ job, applicant }) {
  if (!job || !applicant) {
    throw new Error('بيانات الوظيفة والمتقدم مطلوبة لإجراء التقييم');
  }

  const jobPayload = {
    title: job.title,
    profession: job.profession,
    description: job.description,
    experienceLevel: job.experienceLevel,
    experienceYearsMin: job.experienceYearsMin,
    location: job.location
  };

  const applicantPayload = {
    fullName: applicant.fullName,
    profession: applicant.profession,
    experienceYears: applicant.experienceYears,
    experience: applicant.experience,
    skills: applicant.skills,
    location: applicant.location,
    bio: applicant.bio,
    certificatesCount: applicant.certificates ? applicant.certificates.length : 0
  };

  // 1. Try LLM Evaluation
  let aiResult = null;
  const promptInput = `JOB REQUIREMENTS:\n${JSON.stringify(jobPayload)}\n\nAPPLICANT EVIDENCE:\n${JSON.stringify(applicantPayload)}`;

  if (config.openaiApiKey) {
    aiResult = await callOpenAi(PROMPTS.APPLICANT_REVIEW, promptInput);
  } else if (config.geminiApiKey) {
    aiResult = await callGemini(PROMPTS.APPLICANT_REVIEW, promptInput);
  }

  if (aiResult && aiResult.summary) {
    return {
      ...aiResult,
      humanReviewNote: 'هذا التقييم إرشادي لمساعدة صاحب العمل على تنظيم المقابلة. القرار النهائي يعتمد على المقابلة الشخصية والتقييم العملي.'
    };
  }

  // 2. Deterministic Objective Evaluator (Evidence-based only)
  const demonstratedRequirements = [];
  const notDemonstratedRequirements = [];
  const unclearRequirements = [];

  // Craft & Skills comparison
  const jCraft = detectCraft(job.profession + ' ' + job.title);
  const aCraft = detectCraft(applicant.profession + ' ' + (applicant.skills || ''));

  if (jCraft && aCraft && jCraft.key === aCraft.key) {
    demonstratedRequirements.push(`المهنة متطابقة: التخصص المصرح به (${applicant.profession}) يطابق مهنة الوظيفة (${job.profession}).`);
  } else if (applicant.profession) {
    unclearRequirements.push(`المهنة: صرّح المتقدم بتخصص (${applicant.profession}) بينما تطلب الوظيفة (${job.profession})، يوصى بالاستيضاح.`);
  }

  // Experience comparison
  const reqExp = job.experienceYearsMin || 0;
  const appExp = applicant.experienceYears || 0;

  if (appExp >= reqExp && reqExp > 0) {
    demonstratedRequirements.push(`سنوات الخبرة مستوفاة: يملك المتقدم ${appExp} سنوات خبرة مقابل حد أدنى ${reqExp} سنوات مطلوب.`);
  } else if (reqExp > 0) {
    notDemonstratedRequirements.push(`سنوات الخبرة: مسجل لدى المتقدم ${appExp} سنوات، والوظيفة تطلب ${reqExp} سنوات.`);
  } else {
    demonstratedRequirements.push(`الخبرة مقبولة: الوظيفة لم تشترط حداً أدنى معقداً من السنوات.`);
  }

  // Location comparison
  const jLoc = normalizeArabic(job.location);
  const aLoc = normalizeArabic(applicant.location);
  if (jLoc && aLoc && (jLoc.includes(aLoc) || aLoc.includes(jLoc))) {
    demonstratedRequirements.push(`الموقع الجغرافي مناسب: كلاهما في (${job.location}).`);
  } else {
    unclearRequirements.push(`الموقع الجغرافي: المتقدم مسجل في (${applicant.location}) والوظيفة في (${job.location})، يرجى الاستفسار عن إمكانية الانتقال.`);
  }

  // Stated skills
  if (applicant.skills && applicant.skills.trim()) {
    demonstratedRequirements.push(`المهارات الفنية المسجلة: ${applicant.skills}.`);
  } else {
    unclearRequirements.push('لم يتم إدراج قائمة مهارات تفصيلية في الملف الشخصي.');
  }

  const matchRating = (demonstratedRequirements.length >= 2 && notDemonstratedRequirements.length === 0)
    ? 'strong_match'
    : (demonstratedRequirements.length >= 1 ? 'moderate_match' : 'needs_further_review');

  return {
    summary: `المتقدم ${applicant.fullName} (${applicant.profession}) لديه خبرة معلنة تبلغ ${appExp} سنوات في ${applicant.location}.`,
    demonstratedRequirements,
    notDemonstratedRequirements,
    unclearRequirements,
    matchRating,
    explanation: `تمت مقارنة المؤشرات المهنية الفعلية فقط دون تقييم أي بيانات شخصية غير متعلقة بالوظيفة. مستوفى: ${demonstratedRequirements.length} معيار، وغير مثبت/غير واضح: ${notDemonstratedRequirements.length + unclearRequirements.length} معيار.`,
    missingInfoRecommendation: unclearRequirements.length
      ? `أسئلة مقترحة للمقابلة: 1. هل يناسبك موقع العمل في ${job.location}؟ 2. ما هي أبرز المشاريع السابقة المشابهة لـ "${job.title}"؟`
      : 'بيانات المتقدم كافية لتحديد موعد المقابلة الفنية العملية.',
    humanReviewNote: 'هذا التقييم إرشادي لمساعدة صاحب العمل على تنظيم المقابلة. القرار النهائي يعتمد على المقابلة الشخصية والتقييم العملي.'
  };
}

/**
 * Generate Spoken Arabic Summary for Job Posting
 */
async function generateSpokenJobSummary(job) {
  if (!job) return { summaryText: '' };

  const promptInput = `Job Title: ${job.title}\nCraft: ${job.profession}\nLocation: ${job.location}\nSalary: ${job.salary || 'غير محدد'}`;

  let summaryText = null;

  if (config.openaiApiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.openaiApiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: PROMPTS.SPOKEN_JOB_SUMMARY },
            { role: 'user', content: promptInput }
          ],
          temperature: 0.2
        })
      });
      if (res.ok) {
        const data = await res.json();
        summaryText = data.choices?.[0]?.message?.content?.trim();
      }
    } catch (e) {
      console.warn('[AI_SPOKEN_SUMMARY_FAIL]', e.message);
    }
  }

  if (!summaryText) {
    const salaryPhrase = (job.salary && job.salary !== 'حسب الاتفاق') ? ` براتب ${job.salary}` : '';
    const locationPhrase = job.location ? ` في ${job.location}` : '';
    summaryText = `وظيفة ${job.title}${locationPhrase}${salaryPhrase}. هل تحب نقدملك عليها الآن؟`;
  }

  return { summaryText };
}

module.exports = {
  matchWorkerWithJobs,
  generateJobAdvertisement,
  evaluateApplicant,
  generateSpokenJobSummary,
  localExtractWorkerDetails
};
