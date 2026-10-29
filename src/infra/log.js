// One JSON object per line on stdout, which hosting platforms collect as-is.
// Never pass applicant data, card details or secrets in `fields`.

function write(level, msg, fields) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

export const log = {
  info: (msg, fields = {}) => write('info', msg, fields),
  warn: (msg, fields = {}) => write('warn', msg, fields),
  error: (msg, fields = {}) => write('error', msg, fields),
};
