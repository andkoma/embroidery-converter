/**
 * Centralized logging system for Embroidery Converter
 * Logs are stored in: userData/logs/
 * 
 * Usage:
 *   const logger = require('./main/logger');
 *   logger.info('Application started');
 *   logger.error('Failed to start backend', error);
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logsDir = null;
let logFile = null;
let writeStream = null;

/**
 * Initialize logger with userData path
 * Should be called early in app lifecycle
 */
function init(userDataPath) {
  logsDir = path.join(userDataPath, 'logs');
  
  // Create logs directory if it doesn't exist
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  // Create daily log file: embroidery-converter-YYYY-MM-DD.log
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  logFile = path.join(logsDir, `embroidery-converter-${dateStr}.log`);
  
  // Create write stream for appending
  writeStream = fs.createWriteStream(logFile, { flags: 'a' });
  
  // Cleanup old logs (keep last 30 days)
  cleanupOldLogs();
  
  console.log(`[Logger] Initialized. Logs: ${logFile}`);
}

/**
 * Format timestamp for logs
 */
function timestamp() {
  return new Date().toISOString();
}

/**
 * Sensitive keys that should never be logged
 */
const SENSITIVE_KEYS = [
  'password', 'passwd', 'pwd',
  'token', 'auth', 'authorization',
  'apikey', 'api_key', 'api-key',
  'secret', 'credentials',
  'privatekey', 'private_key',
  'accesstoken', 'access_token',
  'refreshtoken', 'refresh_token',
  'bearer',
  'csc_link', // Code signing cert path
  'csc_key_password',
  'github_token',
  'signing_key'
];

/**
 * Patterns for sensitive data (API keys, URLs with auth, etc.)
 */
const SENSITIVE_PATTERNS = [
  /https?:\/\/[^:]+:[^@]+@/gi,           // URL with password
  /(api[_-]?key|auth|token|secret)\s*[:=]\s*[^\s,}]+/gi, // key=value patterns
  /[a-z0-9]{40,}/gi,                     // Long hex strings (likely tokens)
];

/**
 * Recursively sanitize object to remove sensitive values
 */
function sanitizeObject(obj, depth = 0) {
  if (depth > 10) return '[MAX_DEPTH]';
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }
  
  if (typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, depth + 1));
  }
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    
    // Skip sensitive keys
    if (SENSITIVE_KEYS.some(k => lowerKey.includes(k))) {
      sanitized[key] = '[REDACTED]';
      continue;
    }
    
    sanitized[key] = sanitizeObject(value, depth + 1);
  }
  
  return sanitized;
}

/**
 * Sanitize strings to remove sensitive patterns
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  
  let result = str;
  
  // Redact URLs with auth
  result = result.replace(/https?:\/\/[^:]+:[^@]+@/gi, (match) => {
    const protocol = match.split('://')[0] + '://';
    return protocol + '[USER]:[PASS]@';
  });
  
  // Redact potential tokens/keys (40+ char hex strings)
  result = result.replace(/[a-z0-9]{40,}/gi, (match) => {
    return match.substring(0, 8) + '[..REDACTED..]';
  });
  
  return result;
}

/**
 * Write to log file and console
 */
function write(level, message, data = null) {
  if (!writeStream) {
    console.error('[Logger] Not initialized! Call init() first.');
    return;
  }
  
  const prefix = `[${timestamp()}] [${level}]`;
  
  // Sanitize message and data
  const sanitizedMessage = sanitizeString(message);
  const sanitizedData = data ? sanitizeObject(data) : null;
  
  const logLine = sanitizedData
    ? `${prefix} ${sanitizedMessage} ${JSON.stringify(sanitizedData)}\n`
    : `${prefix} ${sanitizedMessage}\n`;
  
  writeStream.write(logLine);
  
  // Also output to console (with sanitized data)
  if (level === 'ERROR') {
    console.error(`${prefix} ${sanitizedMessage}`, sanitizedData);
  } else if (level === 'WARN') {
    console.warn(`${prefix} ${sanitizedMessage}`, sanitizedData);
  } else {
    console.log(`${prefix} ${sanitizedMessage}`, sanitizedData);
  }
}

/**
 * Log levels
 */
function info(message, data) {
  write('INFO', message, data);
}

function warn(message, data) {
  write('WARN', message, data);
}

function error(message, errOrData) {
  let data = errOrData;
  if (errOrData instanceof Error) {
    data = {
      message: errOrData.message,
      stack: errOrData.stack,
      name: errOrData.name
    };
  }
  write('ERROR', message, data);
}

function debug(message, data) {
  if (process.env.DEBUG) {
    write('DEBUG', message, data);
  }
}

/**
 * Log process status change
 */
function logProcessStatus(processName, status, details = null) {
  info(`[PROCESS] ${processName} -> ${status}`, details);
}

/**
 * Log Python backend startup
 */
function logPythonStartup(pythonPath, args) {
  info('[PYTHON] Starting backend', {
    pythonPath,
    args: args ? args.join(' ') : '(none)',
    platform: process.platform
  });
}

/**
 * Log Python backend output
 */
function logPythonOutput(stream, line) {
  debug(`[PYTHON:${stream}] ${line}`);
}

/**
 * Log Python backend error
 */
function logPythonError(errorMsg, code) {
  error('[PYTHON] Backend error', {
    message: errorMsg,
    code
  });
}

/**
 * Clean up old log files (keep 30 days)
 */
function cleanupOldLogs() {
  if (!logsDir || !fs.existsSync(logsDir)) return;
  
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  
  try {
    const files = fs.readdirSync(logsDir);
    files.forEach(file => {
      const filePath = path.join(logsDir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.mtimeMs < thirtyDaysAgo) {
        fs.unlinkSync(filePath);
        console.log(`[Logger] Deleted old log: ${file}`);
      }
    });
  } catch (err) {
    console.error('[Logger] Cleanup error:', err);
  }
}

/**
 * Get current log file path
 */
function getLogFile() {
  return logFile;
}

/**
 * Get logs directory
 */
function getLogsDir() {
  return logsDir;
}

/**
 * Export logs as string (useful for debugging/support)
 */
function exportLogs() {
  if (!logFile || !fs.existsSync(logFile)) {
    return '[No logs available]';
  }
  
  try {
    return fs.readFileSync(logFile, 'utf-8');
  } catch (err) {
    return `[Failed to read logs: ${err.message}]`;
  }
}

/**
 * Close the write stream (call on app quit)
 */
function close() {
  if (writeStream) {
    writeStream.end();
    writeStream = null;
    console.log('[Logger] Closed.');
  }
}

module.exports = {
  init,
  info,
  warn,
  error,
  debug,
  logProcessStatus,
  logPythonStartup,
  logPythonOutput,
  logPythonError,
  getLogFile,
  getLogsDir,
  exportLogs,
  close
};
