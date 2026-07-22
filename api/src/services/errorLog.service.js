import prisma from '../utils/prisma.js';

// Truncate to keep a single runaway error from writing an enormous row.
const trunc = (s, n) => (s == null ? null : String(s).slice(0, n));

// Persist one captured error. Fire-and-forget: this must NEVER throw or reject
// in a way that affects the request, and must never recurse into itself.
export async function logError({
  source,
  message,
  stack,
  url,
  method,
  statusCode,
  user,
  userId,
  userEmail,
  userRole,
  userAgent,
} = {}) {
  try {
    await prisma.errorLog.create({
      data: {
        source: source === 'frontend' ? 'frontend' : 'backend',
        message: trunc(message, 2000) || 'Unknown error',
        stack: trunc(stack, 8000),
        url: trunc(url, 500),
        method: trunc(method, 10),
        statusCode: Number.isInteger(statusCode) ? statusCode : null,
        userId: user?.id ?? (Number.isInteger(userId) ? userId : null),
        userEmail: trunc(user?.email ?? userEmail, 200),
        userRole: trunc(user?.role ?? userRole, 40),
        userAgent: trunc(userAgent, 500),
      },
    });
  } catch (e) {
    // Logging the error must not itself surface an error to the client, and we
    // deliberately do NOT write this failure back into the table (no loop).
    console.error('Failed to write error log:', e?.message || e);
  }
}
