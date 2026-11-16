function errorHandler(err, req, res, next) {
  // Structured safe server-side logging
  console.error('[SERVER_ERROR]', {
    method: req.method,
    path: req.originalUrl,
    timestamp: new Date().toISOString(),
    message: err.message,
    code: err.code
  });

  // Handle Multer upload errors
  if (err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      message: `خطأ في رفع الملف: ${err.message}`
    });
  }

  // Handle Prisma errors safely without exposing internal SQL or schema details
  if (err.code && err.code.startsWith('P')) {
    if (err.code === 'P2002') {
      const field = err.meta?.target ? ` (${err.meta.target})` : '';
      return res.status(409).json({
        success: false,
        message: `هذا السجل موجود بالفعل ومكرر${field}`
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'السجل المطلوب غير موجود'
      });
    }
    return res.status(400).json({
      success: false,
      message: 'تعذر إتمام العملية في قاعدة البيانات، يرجى التحقق من صحة المدخلات'
    });
  }

  // Generic 500 error: Never leak stack traces to client
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'حدث خطأ غير متوقع في الخادم، يرجى المحاولة لاحقاً' : err.message
  });
}

module.exports = errorHandler;
