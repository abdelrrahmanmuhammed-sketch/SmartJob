// Arabic Text Normalization & Blue-Collar Synonym Dictionary

function normalizeArabic(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .trim()
    .toLowerCase()
    // Remove diacritics (tashkeel)
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // Normalize Alif forms (أ, إ, آ, ٱ -> ا)
    .replace(/[أإآٱ]/g, 'ا')
    // Normalize Yaa / Alif Maqsura (ى -> ي)
    .replace(/ى/g, 'ي')
    // Normalize Taa Marbouta (ة -> ه)
    .replace(/ة/g, 'ه')
    // Normalize Hamza forms
    .replace(/[ؤئ]/g, 'ء')
    // Remove extra whitespace
    .replace(/\s+/g, ' ');
}

// Blue-Collar Crafts Dictionary for Egypt & MENA
const CRAFTS = [
  {
    key: 'painter',
    canonical: 'نقاش',
    label: 'نقاش (فني دهانات وتشطيبات)',
    synonyms: ['نقاش', 'نقاشه', 'دهان', 'دهانات', 'بويات', 'معجون', 'دوكو', 'تشطيب شقق', 'دهان شقق']
  },
  {
    key: 'plumber',
    canonical: 'سباك',
    label: 'سباك (فني صحي وسباكة)',
    synonyms: ['سباك', 'سباكه', 'صحي', 'مواسير', 'سيفون', 'خلاطات', 'تاسيس صحي', 'شبكات مياه']
  },
  {
    key: 'electrician',
    canonical: 'كهربائي',
    label: 'فني كهرباء (صناعي وسلسيون)',
    synonyms: ['كهربائي', 'كهربا', 'سلسيون', 'لوحات', 'كابلات', 'كنترول', 'تمديدات كهرباء', 'كهربائي مصانع']
  },
  {
    key: 'carpenter',
    canonical: 'نجار',
    label: 'نجار (مسلح / باب وشباك)',
    synonyms: ['نجار', 'نجاره', 'مسلح', 'باب وشباك', 'موبيليا', 'خشب', 'اثاث', 'فورم']
  },
  {
    key: 'blacksmith',
    canonical: 'حداد',
    label: 'حداد (كريتال / تسليح)',
    synonyms: ['حداد', 'حداده', 'كريتال', 'تسليح', 'صاج', 'معادن', 'حديد']
  },
  {
    key: 'tiler',
    canonical: 'مبلط',
    label: 'مبلط سيراميك وبورسلين',
    synonyms: ['مبلط', 'بلاط', 'سيراميك', 'بورسلين', 'رخام', 'ارضيات']
  },
  {
    key: 'welder',
    canonical: 'عامل لحام',
    label: 'عامل لحام (أرجون وكهرباء)',
    synonyms: ['لحام', 'ارجون', 'لحامات', 'اكسجين', 'لحام مواسير', 'لحام هياكل']
  },
  {
    key: 'hvac',
    canonical: 'فني تبريد وتكييف',
    label: 'فني تبريد وتكييف',
    synonyms: ['تبريد', 'تكييف', 'تكييفات', 'سبليت', 'شارب', 'كارير', 'فريون', 'كباس', 'صيانه تكييف']
  },
  {
    key: 'mechanic',
    canonical: 'فني ميكانيكا',
    label: 'فني ميكانيكا وصيانة',
    synonyms: ['ميكانيكي', 'ميكانيكا', 'عفشه', 'محركات', 'معدات', 'سيور', 'صيانه خطوط', 'صيانه ميكانيكيه']
  },
  {
    key: 'driver',
    canonical: 'سائق',
    label: 'سائق مهني',
    synonyms: ['سائق', 'سواق', 'رخصه مهنيه', 'معدات ثقيله', 'شاحنه', 'نقل ثقيل']
  }
];

// Egyptian Governorates & Cities
const GOVERNORATES = [
  'القاهرة', 'الجيزة', 'الإسكندرية', 'كفر الشيخ', 'المنصورة', 'الدقهلية',
  'طنطا', 'الغربية', 'العاشر من رمضان', 'الشرقية', '6 أكتوبر', 'القليوبية',
  'المنوفية', 'البحيرة', 'دمياط', 'بورسعيد', 'الإسماعيلية', 'السويس',
  'الفيوم', 'بني سويف', 'المنيا', 'أسيوط', 'سوهاج', 'قنا', 'الأقصر', 'أسوان'
];

function detectCraft(text) {
  const norm = normalizeArabic(text);
  for (const craft of CRAFTS) {
    for (const syn of craft.synonyms) {
      if (norm.includes(normalizeArabic(syn))) {
        return craft;
      }
    }
  }
  return null;
}

function detectLocation(text) {
  const norm = normalizeArabic(text);
  for (const gov of GOVERNORATES) {
    if (norm.includes(normalizeArabic(gov))) {
      return gov;
    }
  }
  return null;
}

function detectExperienceYears(text) {
  const norm = normalizeArabic(text);
  if (norm.includes('عشر سنين') || norm.includes('عشر سنوات') || norm.includes('10 سنين') || norm.includes('10 سنوات')) {
    return 10;
  }
  if (norm.includes('سنتين') || norm.includes('سنتان') || norm.includes('2 سنه') || norm.includes('2 سنوات')) {
    return 2;
  }
  if (norm.includes('سنه واحده') || norm.includes('سنه')) {
    return 1;
  }
  const match = norm.match(/(\d+)\s*(سنه|سنين|سنوات)/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return 0;
}

module.exports = {
  normalizeArabic,
  CRAFTS,
  GOVERNORATES,
  detectCraft,
  detectLocation,
  detectExperienceYears
};
